import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { POSTS_TABLE } from "@/lib/postsStore";
import { dedupeKey } from "@/lib/posts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/upload — client job-site photo / short-form video upload.
 * Accepts a Base64 image (data:image/...) or a short .mp4/WebM
 * (data:video/...), assigns a stable dedupe fingerprint, and inserts a
 * Draft post into the active approval queue. Uploaded media inherits the
 * render-time watermark shell on every preview (CSS overlay — original is
 * never cropped). Persists to Supabase when configured; otherwise echoes
 * success so the dashboard can optimistically add it to the local queue.
 */
export async function POST(req: Request) {
  let body: { image?: string; caption?: string; filename?: string; topic?: string } = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.image) {
    return NextResponse.json(
      { error: "A data:image/... or data:video/... payload is required." },
      { status: 400 }
    );
  }

  // Detect media type from the data URI prefix.
  const isVideo = body.image.startsWith("data:video/");
  const isImage = body.image.startsWith("data:image/");
  if (!isVideo && !isImage) {
    return NextResponse.json(
      { error: "Unsupported media. Send a data:image/... or data:video/... URI." },
      { status: 400 }
    );
  }

  const mediaType: "image" | "video" = isVideo ? "video" : "image";
  const topic = body.topic || (isVideo ? "job-site-video" : "job-site");
  const angle = "client-upload";
  const imageVariant = `upload-${Date.now()}`;
  const fileName = body.filename || (isVideo ? "job-site-upload.mp4" : "job-site-upload.jpg");
  const id = `upload-${Date.now()}`;

  const meta = { topic, angle, imageVariant, uploaded: true };
  const dedupe = dedupeKey({ ...meta, mediaType });

  const db = getServerSupabase();
  if (db) {
    // Persist to the queue with snake_case columns matching the schema.
    const { error } = await db.from(POSTS_TABLE).insert({
      id,
      date: new Date().toISOString().slice(0, 10),
      platform: "Facebook",
      caption: body.caption || `New ${isVideo ? "video" : "job-site photo"} — ${fileName}`,
      image: body.image, // data URI (stored for the queue)
      status: "Draft",
      flagged_for_review: false,
      topic: meta.topic,
      angle: meta.angle,
      image_variant: meta.imageVariant,
      uploaded: true,
      media_type: mediaType,
      media_url: isVideo ? body.image : null,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    id,
    platform: "Facebook",
    caption: body.caption || `New ${isVideo ? "video" : "job-site photo"} — ${fileName}`,
    image: body.image,
    status: "Draft",
    mediaType,
    dedupe,
    watermarked: "render-time",
    note: db ? "Queued in Supabase." : "Demo mode: not persisted.",
  });
}
