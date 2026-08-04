import prisma from "@/lib/prisma";
import { convertPdfToImageRoute } from "@/lib/trigger/pdf-to-image-route";
import { conversionQueueName } from "@/lib/utils/trigger-utils";

/**
 * Publish an already-uploaded PDF as the new primary version of a document.
 *
 * Links reference the document, not a version, so every link that has already
 * been shared serves the new deck as soon as this returns.
 */
export async function publishDeckVersion({
  documentId,
  url,
  numPages,
  fileSize,
  contentType = "application/pdf",
}: {
  documentId: string;
  url: string;
  numPages: number;
  fileSize?: number;
  contentType?: string;
}) {
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
    throw new Error("Document not found");
  }

  const teamId = document.teamId;
  const version = await prisma.documentVersion.create({
    data: {
      documentId,
      file: url,
      originalFile: url,
      type: "pdf",
      storageType: "VERCEL_BLOB",
      numPages,
      isPrimary: true,
      versionNumber: (document.versions[0]?.versionNumber ?? 0) + 1,
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

  return {
    documentVersionId: version.id,
    versionNumber: version.versionNumber,
    numPages,
  };
}
