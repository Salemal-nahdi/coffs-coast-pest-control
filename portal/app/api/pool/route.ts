import { NextResponse } from "next/server";
import { DEFAULT_POOL, findPoolDuplicates, dedupeKey } from "@/lib/posts";

export const dynamic = "force-dynamic";

/**
 * GET /api/pool — returns the current 10-option content pool for client
 * selection (pick 6), plus duplicate-prevention metadata report.
 */
export async function GET() {
  const pool = DEFAULT_POOL;
  const duplicates = findPoolDuplicates(pool);
  return NextResponse.json({
    poolSize: pool.length,
    draftSelect: 6,
    duplicateFree: duplicates.length === 0,
    duplicates,
    pool: pool.map((p) => ({
      id: p.id,
      topic: p.topic,
      angle: p.angle,
      imageVariant: p.imageVariant,
      platform: p.platform,
      caption: p.caption,
      image: p.image,
      dedupeKey: dedupeKey(p),
    })),
  });
}
