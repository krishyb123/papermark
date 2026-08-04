import { NextApiRequest, NextApiResponse } from "next";

import { del, list, put } from "@vercel/blob";
import { PDFDocument } from "pdf-lib";

import { publishDeckVersion } from "@/lib/deck/publish-version";

/**
 * POST /api/internal/deck-publish-commit
 * Body: { session, documentId }
 *
 * Merges the slide PDFs staged by deck-slide-upload into a single deck, then
 * publishes it as the new version. Every existing link picks it up.
 *
 * Auth: Bearer DECK_PUBLISH_KEY.
 */
export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
  maxDuration: 300,
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!process.env.DECK_PUBLISH_KEY || token !== process.env.DECK_PUBLISH_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { session, documentId } = req.body as {
    session?: string;
    documentId?: string;
  };
  if (!session || !/^[a-zA-Z0-9_-]{6,64}$/.test(session) || !documentId) {
    return res.status(400).json({ error: "session and documentId required" });
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

  try {
    const staged = await list({
      prefix: `deck-staging/${session}/`,
      token: blobToken,
    });
    if (!staged.blobs.length) {
      return res.status(400).json({ error: "No slides staged for session" });
    }

    // Pathnames are zero-padded indices, so lexical order is slide order.
    const ordered = staged.blobs
      .slice()
      .sort((a, b) => a.pathname.localeCompare(b.pathname));

    const merged = await PDFDocument.create();
    for (const blob of ordered) {
      const r = await fetch(blob.url);
      if (!r.ok) throw new Error(`could not read ${blob.pathname}`);
      const slide = await PDFDocument.load(await r.arrayBuffer());
      const pages = await merged.copyPages(slide, slide.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }

    const bytes = Buffer.from(await merged.save());
    const numPages = merged.getPageCount();

    const deck = await put("BobbyBrowser_Deck.pdf", bytes, {
      access: "public",
      contentType: "application/pdf",
      addRandomSuffix: true,
      token: blobToken,
    });

    const result = await publishDeckVersion({
      documentId,
      url: deck.url,
      numPages,
      fileSize: bytes.length,
    });

    // Staging blobs are disposable once merged.
    await del(
      ordered.map((b) => b.url),
      { token: blobToken },
    ).catch(() => undefined);

    return res.status(200).json({ ...result, slides: ordered.length });
  } catch (error) {
    return res.status(500).json({
      error: "Commit failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
