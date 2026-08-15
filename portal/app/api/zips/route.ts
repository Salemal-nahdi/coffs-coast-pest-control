import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import { join, resolve } from "path";

export const dynamic = "force-dynamic";

interface ZipInfo {
  name: string;
  url: string;
  size: number;
  created: string;
  source: "storage" | "local";
}

/**
 * GET /api/zips — discover the latest generated asset bundle for download.
 *
 * Preference order (serverless-safe):
 *   1. Supabase Storage — the montage worker uploads each batch here so the
 *      bundle persists across Vercel Lambda lifecycles. Lists the bucket and
 *      returns the newest object's public URL.
 *   2. Local `public/zips/` — fallback for self-hosted / local runs where the
 *      worker wrote the archive directly to disk.
 *
 * This keeps the dashboard download link working seamlessly on Vercel where
 * files written to `public/zips/` at runtime are ephemeral.
 */
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "asset-bundles";
  const prefix = (process.env.SUPABASE_STORAGE_PREFIX || "zips").replace(/^\/+|\/+$/g, "");

  // 1) Supabase Storage (persistent — preferred for Vercel).
  if (supabaseUrl && supabaseKey) {
    try {
      const listRes = await fetch(
        `${supabaseUrl}/storage/v1/object/list/${bucket}/${prefix}`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(12000),
        }
      );
      if (listRes.ok) {
        const objects = (await listRes.json()) as Array<{
          name: string;
          size?: number;
          updated_at?: string;
          id?: string;
        }>;
        const zips: ZipInfo[] = objects
          .filter((o) => o.name && o.name.toLowerCase().endsWith(".zip"))
          .map((o) => ({
            name: o.name,
            url: `${supabaseUrl}/storage/v1/object/public/${bucket}/${prefix}/${o.name}`,
            size: o.size ?? 0,
            created: o.updated_at ?? "",
            source: "storage" as const,
          }))
          .sort((a, b) => (a.created < b.created ? 1 : -1)); // newest first

        if (zips.length > 0) {
          return NextResponse.json({
            available: true,
            zips,
            latest: zips[0],
            count: zips.length,
            source: "storage",
          });
        }
      }
    } catch {
      /* storage unavailable — fall through to local */
    }
  }

  // 2) Local `public/zips/` fallback.
  const zipsDir = resolve(process.cwd(), "public", "zips");
  let entries;
  try {
    entries = await readdir(zipsDir);
  } catch {
    return NextResponse.json({ available: false, zips: [], source: "none" });
  }

  const zips: ZipInfo[] = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith(".zip")) continue;
    const full = join(zipsDir, name);
    try {
      const s = await stat(full);
      zips.push({
        name,
        url: `/zips/${name}`,
        size: s.size,
        created: s.mtime.toISOString(),
        source: "local",
      });
    } catch {
      /* skip unreadable entry */
    }
  }

  zips.sort((a, b) => (a.created < b.created ? 1 : -1)); // newest first
  return NextResponse.json({
    available: zips.length > 0,
    zips,
    latest: zips[0] ?? null,
    count: zips.length,
    source: zips.length > 0 ? "local" : "none",
  });
}