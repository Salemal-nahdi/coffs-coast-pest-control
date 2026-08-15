import { NextResponse } from "next/server";
import { notifyClientReady } from "@/lib/notify";

export const dynamic = "force-dynamic";

// Vercel Cron-friendly secret guard. Set CRON_SECRET in env and pass it via
// Authorization header or ?secret=. If unset, still runs (keeps zero-maintenance).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") || req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET;
  if (expected && secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await notifyClientReady();
  return NextResponse.json(result);
}
