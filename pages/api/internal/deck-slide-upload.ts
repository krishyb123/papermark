import { NextApiRequest, NextApiResponse } from "next";

import { put } from "@vercel/blob";

/**
 * POST /api/internal/deck-slide-upload?session=<id>&index=<n>
 *
 * Accepts a single slide exported as PDF (raw body) from the Figma plugin and
 * parks it in blob storage. Slides are uploaded one at a time so each request
 * stays well under Vercel's 4.5 MB body limit; deck-publish-commit merges them.
 *
 * Auth: Bearer DECK_PUBLISH_KEY.
 */
export const config = {
  api: { bodyParser: false },
};

const MAX_SLIDE_BYTES = 4 * 1024 * 1024;

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // The plugin UI runs in a sandboxed iframe with a null origin.
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

  const session = String(req.query.session ?? "");
  const index = Number(req.query.index);
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(session) || !Number.isInteger(index)) {
    return res.status(400).json({ error: "Invalid session or index" });
  }

  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_SLIDE_BYTES) {
        return res.status(413).json({ error: "Slide too large" });
      }
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);

    if (body.subarray(0, 4).toString() !== "%PDF") {
      return res.status(400).json({ error: "Body is not a PDF" });
    }

    // Deterministic path so commit can find the slides in order.
    const blob = await put(
      `deck-staging/${session}/${String(index).padStart(4, "0")}.pdf`,
      body,
      {
        access: "public",
        contentType: "application/pdf",
        addRandomSuffix: false,
        allowOverwrite: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      },
    );

    return res.status(200).json({ index, url: blob.url, bytes: body.length });
  } catch (error) {
    return res.status(500).json({
      error: "Slide upload failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
