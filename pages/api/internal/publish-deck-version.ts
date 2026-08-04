import { NextApiRequest, NextApiResponse } from "next";

import { publishDeckVersion } from "@/lib/deck/publish-version";

/**
 * POST /api/internal/publish-deck-version
 *
 * Publishes a new version of an existing document from an already-uploaded
 * PDF URL. Every link pointing at the document serves the new version
 * immediately — no link needs to be recreated or re-sent.
 *
 * Auth: Bearer DECK_PUBLISH_KEY, so this can be called by a cron job, an
 * external webhook, or a local script.
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

  const { documentId, url, numPages, fileSize, contentType } = req.body as {
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
    const result = await publishDeckVersion({
      documentId,
      url,
      numPages,
      fileSize,
      contentType,
    });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to publish version",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
