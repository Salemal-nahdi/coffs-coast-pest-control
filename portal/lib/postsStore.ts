import { getServerSupabase } from "./supabase";
import { DEFAULT_POSTS, Post, buildMonthlySchedule } from "./posts";

export const POSTS_TABLE = "social_posts";

/**
 * Load the full schedule of posts.
 * - If Supabase is configured, reads from the `social_posts` table.
 * - Otherwise returns the built-in default schedule, spread across the
 *   next month's Tue/Thu cadence (Smart Calendar Spacing).
 */
export async function getPosts(): Promise<Post[]> {
  const db = getServerSupabase();
  if (!db) {
    // Smart spacing: defaults land on future Tue/Thu slots, not consecutive days.
    return buildMonthlySchedule(DEFAULT_POSTS);
  }

  try {
    const { data, error } = await db
      .from(POSTS_TABLE)
      .select("*")
      .order("date", { ascending: true });

    if (error || !data || data.length === 0) {
      // Empty/missing table -> seed with smart-spaced defaults.
      return buildMonthlySchedule(DEFAULT_POSTS);
    }

    // DB column names are snake_case (media_type, media_url, image_variant);
    // map them into the Post media model so video posts render with the
    // HTML5 player and batch metadata is preserved.
    return (data as any[]).map((r) => ({
      id: r.id,
      date: r.date,
      platform: r.platform,
      caption: r.caption ?? "",
      image: r.image,
      status: r.status === "Approved" ? "Approved" : "Draft",
      mediaType: (r.media_type as "image" | "video") || undefined,
      mediaUrl: r.media_url || undefined,
      topic: r.topic || undefined,
      angle: r.angle || undefined,
      imageVariant: r.image_variant || undefined,
      uploaded: r.uploaded || undefined,
    }));
  } catch {
    return buildMonthlySchedule(DEFAULT_POSTS);
  }
}

/**
 * Merge live (DB) posts over defaults so any posts never seen in the
 * DB still render. Returns posts deduplicated by id.
 */
export function mergePosts(live: Post[], fallback: Post[] = DEFAULT_POSTS): Post[] {
  const map = new Map<string, Post>();
  for (const p of fallback) map.set(p.id, p);
  for (const p of live) map.set(p.id, p);
  return Array.from(map.values());
}
