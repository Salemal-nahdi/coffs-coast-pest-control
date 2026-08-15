import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { POSTS_TABLE } from "@/lib/postsStore";

export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

/**
 * PATCH /api/posts/[id]  — update caption and/or status for a post.
 * Writes straight to Supabase. Returns 200 with the updated record,
 * or 404/500 when Supabase is unavailable.
 */
export async function PATCH(req: Request, { params }: Params) {
  const db = getServerSupabase();
  if (!db) {
    return NextResponse.json(
      { error: "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." },
      { status: 500 }
    );
  }

  let body: { caption?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "Missing post id." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.caption === "string") updates.caption = body.caption;
  if (body.status === "Approved" || body.status === "Draft") updates.status = body.status;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // Set review flag when approving.
  if (body.status === "Approved") {
    updates.flagged_for_review = true;
    updates.approved_at = new Date().toISOString();
  }

  const { data, error } = await db
    .from(POSTS_TABLE)
    .update(updates)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ post: data });
}
