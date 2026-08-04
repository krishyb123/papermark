import { NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";
import { convertPdfToImageRoute } from "@/lib/trigger/pdf-to-image-route";
import { conversionQueueName } from "@/lib/utils/trigger-utils";

/**
 * POST /api/internal/publish-deck-version
 *
 * Publishes a new version of an existing document from an already-uploaded
 * PDF URL. Every link pointing at the document serves the new version
 * immediately — no link needs to be recreated or re-sent.
 *
 * Auth: Bearer INTERNAL_API_KEY (same key the trigger tasks use), so this can
 * be called by a cron job, an external webhook, or a local script.
 *
 * Body: { documentId, url, numPages, fileSize?, contentType? }
 */
export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!process.env.DECK_PUBLISH_KEY || token !== process.env.DECK_PUBLISH_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    documentId,
    url,
    numPages,
    fileSize,
    contentType = "application/pdf",
  } = req.body as {
    documentId?: string;
    url?: string;
    numPages?: number;
    fileSize?: number;
    contentType?: string;
  };

  if (!documentId || !url || !numPages) {
    return res
      .status(400)
      .json({ error: "documentId, url and numPages are required" });
  }

  const blobHost = process.env.VERCEL_BLOB_HOST;
  if (!blobHost || !url.startsWith(`https://${blobHost}`)) {
    return res
      .status(400)
      .json({ error: "url must be a file on the configured blob host" });
  }

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        teamId: true,
        team: { select: { plan: true } },
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { versionNumber: true },
        },
      },
    });

    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    const teamId = document.teamId;
    const nextVersionNumber = (document.versions[0]?.versionNumber ?? 0) + 1;

    const version = await prisma.documentVersion.create({
      data: {
        documentId,
        file: url,
        originalFile: url,
        type: "pdf",
        storageType: "VERCEL_BLOB",
        numPages,
        isPrimary: true,
        versionNumber: nextVersionNumber,
        contentType,
        fileSize,
      },
    });

    // Only one version may be primary; demote the rest.
    await prisma.documentVersion.updateMany({
      where: { documentId, id: { not: version.id } },
      data: { isPrimary: false },
    });

    await prisma.document.update({
      where: { id: documentId },
      data: { numPages },
    });

    await convertPdfToImageRoute.trigger(
      {
        documentId,
        documentVersionId: version.id,
        teamId,
        versionNumber: version.versionNumber,
      },
      {
        idempotencyKey: `${teamId}-${version.id}`,
        tags: [
          `team_${teamId}`,
          `document_${documentId}`,
          `version:${version.id}`,
        ],
        queue: conversionQueueName(document.team?.plan ?? "free"),
        concurrencyKey: teamId,
      },
    );

    return res.status(200).json({
      documentVersionId: version.id,
      versionNumber: version.versionNumber,
      numPages,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to publish version",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
