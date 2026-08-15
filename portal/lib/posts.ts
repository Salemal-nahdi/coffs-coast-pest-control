export type Platform = "Facebook" | "Instagram" | "Google Business Profile";

/**
 * Smart Calendar Spacing — scheduling days for the monthly cadence.
 * JS getDay(): 0=Sun … 6=Sat. Default Tuesdays (2) & Thursdays (4).
 */
export const SCHEDULE_DAYS: number[] = [2, 4];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/**
 * All weekdays in the given month that fall on the scheduling days
 * (e.g. every Tuesday & Thursday of the month).
 */
export function scheduledDatesOfMonth(
  base: Date = new Date(),
  days: number[] = SCHEDULE_DAYS
): Date[] {
  const out: Date[] = [];
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (days.includes(d.getDay())) out.push(new Date(d));
  }
  return out;
}

/**
 * Assign `count` post slots across a month's scheduling weekdays,
 * returning ISO date strings (YYYY-MM-DD). Cycles if a month has fewer
 * scheduling days than slots needed.
 */
export function assignSchedule(
  count: number,
  base: Date = new Date(),
  days: number[] = SCHEDULE_DAYS
): string[] {
  const slots = scheduledDatesOfMonth(base, days);
  if (!slots.length) {
    return Array.from(
      { length: count },
      (_, i) =>
        iso(addDays(new Date(base.getFullYear(), base.getMonth(), 1), i))
    );
  }
  return Array.from({ length: count }, (_, i) => iso(slots[i % slots.length]));
}

/**
 * Build the default schedule spread across the NEXT month's Tue/Thu
 * cadence (so the calendar always shows future, spaced-out posts) rather
 * than fixed consecutive days.
 */
export function buildMonthlySchedule(posts: Post[] = DEFAULT_POSTS): Post[] {
  const next = new Date();
  next.setMonth(next.getMonth() + 1);
  const dates = assignSchedule(posts.length, next);
  return posts.map((p, i) => ({ ...p, date: dates[i] ?? p.date }));
}

/* =====================================================================
 * Expanded Generation Support (Enhancement 3)
 * ---------------------------------------------------------------------
 * Modular hook surface so the portal is not restricted to the initial
 * static image set. Consuming code can swap in providers (Unsplash/
 * Pexels API, image-generation service, a marketing team's upload, etc.)
 * without touching the display layer.
 * ===================================================================== */

export interface GeneratedAsset {
  id: string;
  /** Public path or remote URL the <Image> can use. */
  src: string;
  /** Suggested caption + hashtags for the generated asset. */
  caption: string;
  platform: Platform;
}

export interface AssetSource {
  /** Human-readable name, shown in logs/status. */
  name: string;
  /** Whether this source is currently configured/available. */
  configured: boolean;
  /**
   * Pull/generate `count` fresh assets for a given month.
   * Return [] if no assets can be produced (graceful fallback keeps the
   * portal stable — replaces an empty list with static defaults).
   */
  generate(count: number, month: Date): Promise<GeneratedAsset[]>;
}

/**
 * Default asset source: the portal's static brand JPEGs (p1–p6).
 * Always "configured" so the app never breaks before a provider is added.
 */
export const STATIC_ASSET_SOURCE: AssetSource = {
  name: "static-brand-bundle",
  configured: true,
  async generate(count: number): Promise<GeneratedAsset[]> {
    const base = DEFAULT_POSTS.slice(0, Math.max(1, count));
    return base.map((p) => ({
      id: p.id,
      src: p.image,
      caption: p.caption,
      platform: p.platform,
    }));
  },
};

/**
 * Registry of available asset providers (excluding the static fallback).
 * Register a real provider here (e.g. a Pexels/Unsplash/upload-backed
 * source) to let monthly generation pull fresh imagery. When none are
 * configured, the portal simply keeps using its current data source
 * (Supabase live rows or the static bundle). The first configured source
 * wins.
 */
export const ASSET_SOURCES: AssetSource[] = [];

/**
 * Resolve the active asset provider. Returns undefined when no real
 * provider is configured (so the portal falls through to live data).
 */
export function getActiveAssetSource(): AssetSource | undefined {
  return ASSET_SOURCES.find((s) => s.configured);
}

/**
 * Generate or pull the month's asset roster from a configured provider.
 * Returns null (not an array) when no provider is configured, so callers
 * can fall back to their existing data source. Never throws — on any
 * provider failure it degrades to the static brand bundle.
 */
export async function generateMonthlyAssets(
  count: number,
  month: Date = new Date()
): Promise<GeneratedAsset[] | null> {
  const src = getActiveAssetSource();
  if (!src) return null; // no provider -> caller keeps current data
  try {
    const generated = await src.generate(count, month);
    if (generated && generated.length > 0) return generated;
  } catch {
    /* fall through to static */
  }
  return STATIC_ASSET_SOURCE.generate(count, month);
}

export interface Post {
  id: string;
  /** Simple string date key for the calendar grid, e.g. "2026-08-10". */
  date: string;
  platform: Platform;
  /** Baseline caption. Clients may edit this inline; edits persist to Supabase. */
  caption: string;
  /** Public path to the brand JPEG (referenced by filename only). */
  image: string;
  status: "Draft" | "Approved";
  /* ---- Mixed-media support (images + short-form branded videos) ----
   * Both `image` and media stay optional/backwards-compatible. When
   * `mediaType === "video"`, consumers render an HTML5 <video> player
   * from `mediaUrl` (a `.mp4`) instead of the static <img>. */
  /** "image" (default) or "video" for short-form .mp4 content. */
  mediaType?: "image" | "video";
  /** Public path/URL to the source media — same value as `image` for
   *  images, or a `.mp4` path for video assets. */
  mediaUrl?: string;
  /* ---- 10-to-6 batch workflow metadata (optional extensions) ----
   * Kept optional so existing rows/records remain fully compatible. */
  /** No-op placeholder to keep old Post assignments compiling. */
  _batchExt?: never;
  /** Short content topic, e.g. "termite-guard". Used for duplicate checks. */
  topic?: string;
  /** Content angle/tagline, e.g. "as3660-education". */
  angle?: string;
  /** Image variant key (dedupe against same image reused twice). */
  imageVariant?: string;
  /** Whether this option sits in the 10-option pool vs. the confirmed 6. */
  inPool?: boolean;
  /** Client upload metadata (topic derived from filename/alt). */
  uploaded?: boolean;
}

/**
 * 10-TO-6 CONTENT POOL — the monthly roster of up to 10 candidate posts.
 * Clients pick (or auto-pick) 6 for the schedule; duplicates are rejected.
 */
export interface PoolPost {
  id: string;
  topic: string;
  angle: string;
  imageVariant: string;
  platform: Platform;
  caption: string;
  image: string;
  /** Mixed-media: "image" (default) or "video" (.mp4 short-form). */
  mediaType?: "image" | "video";
  /** Source media path — for video this is the `.mp4`; images reuse `image`. */
  mediaUrl?: string;
  /** fingerprint for duplicate-prevention metadata check. */
  dedupeKey: string;
}

/** True when a pool item is short-form video (.mp4). */
export function isVideoMedia(p: { mediaType?: "image" | "video" }): boolean {
  return p.mediaType === "video";
}

/** Resolve the playable src for a post: video uses mediaUrl, images image. */
export function mediaSrc(p: {
  mediaType?: "image" | "video";
  mediaUrl?: string;
  image?: string;
}): string {
  return isVideoMedia(p) ? p.mediaUrl || p.image || "" : p.image || "";
}

/** Build a stable dedupe fingerprint from topic+angle+imageVariant. */
export function dedupeKey(p: {
  topic?: string;
  angle?: string;
  imageVariant?: string;
  image?: string;
  mediaType?: "image" | "video";
}): string {
  // mediaType is folded into the fingerprint so a video based on the same
  // topic/angle as an image is treated as a distinct creative, not a dup.
  return [p.topic || "", p.angle || "", p.imageVariant || "", p.image || "", p.mediaType || "image"]
    .join("::")
    .toLowerCase()
    .trim();
}

/**
 * Default 10-option content pool for the month (pulled/staged), mapped to
 * the static brand assets so nothing breaks until a real provider is added.
 * Each option carries distinct topic/angle/imageVariant metadata.
 */
export const DEFAULT_POOL: PoolPost[] = ([
  { id: "pool-1",  topic: "general-pest",  angle: "call-to-book",    imageVariant: "p1", platform: "Instagram",       caption: "🐜 Protecting Coffs Harbour homes year-round. Book your general pest treatment today — call Cristian on 0449 252 963. #CoffsCoastPestControl #PestFreeHome", image: "/images/p1.jpg",  dedupeKey: "" },
  { id: "pool-2",  topic: "termite-guard", angle: "as3660-education", imageVariant: "p2", platform: "Facebook",        caption: "Did you know termites cause more damage than fire each year in Australia? Stay ahead with an AS 3660 compliant termite inspection. ☎️ 0449 252 963", image: "/images/p2.jpg",  dedupeKey: "" },
  { id: "pool-3",  topic: "rodent-control",angle: "peace-of-mind",   imageVariant: "p3", platform: "Facebook",        caption: "Rodent-free means rest easy. Discreet, effective rodent control across the Coffs Coast. ABN 95 610 493 013. Message us to book a spring clean treatment.", image: "/images/p3.jpg",  dedupeKey: "" },
  { id: "pool-4",  topic: "local-experts", angle: "family-run",      imageVariant: "p4", platform: "Instagram",       caption: "Your local, family-run pest experts 🏡 Coffs Harbour, Woolgoolga, Sawtell & beyond. Free quotes — call 0449 252 963 today!", image: "/images/p4.jpg",  dedupeKey: "" },
  { id: "pool-5",  topic: "reviews",       angle: "google-reviews",  imageVariant: "p5", platform: "Google Business Profile", caption: "Loved by our local customers ⭐ Friendly, thorough and reliable pest control. If you've used our service, we'd be grateful for your Google review!", image: "/images/p5.jpg",  dedupeKey: "" },
  { id: "pool-6",  topic: "spider-season", angle: "seasonal-prep",   imageVariant: "p6", platform: "Facebook",        caption: "Spider season is coming 🕷️ Put the kettle on and leave the web-work to us. General pest + spider treatment, one call: 0449 252 963.", image: "/images/p6.jpg",  dedupeKey: "" },
  // Two additional staged variants to reach a 10-option pool (topic rotates back,
  // distinct imageVariant/angle so no double-up of topic+angle+image).
  { id: "pool-7",  topic: "general-pest",  angle: "safety-steps",    imageVariant: "p1-alt", platform: "Instagram",          caption: "🐜 Safe, family-friendly treatment. Re-entry 1–2 hrs after drying. ☎️ 0449 252 963", image: "/images/p1.jpg",  dedupeKey: "" },
  { id: "pool-8",  topic: "termite-guard", angle: "peace-of-mind",   imageVariant: "p2-alt", platform: "Facebook",           caption: "Termites don't take holidays. 12-monthly AS 3660 inspections keep your investment safe.", image: "/images/p2.jpg",  dedupeKey: "" },
  { id: "pool-9",  topic: "rodent-control",angle: "call-to-book",    imageVariant: "p3-alt", platform: "Instagram",          caption: "Rodents breed fast — act fast. Discreet local control across the Coffs Coast.", image: "/images/p3.jpg",  dedupeKey: "" },
  { id: "pool-10", topic: "seasonal",      angle: "spring-prep",     imageVariant: "p4-alt", platform: "Google Business Profile", caption: "Spring is here 🌿 Get ahead of pests with a seasonal treatment plan.", image: "/images/p4.jpg",  dedupeKey: "" },
] as const).map((p) => ({ ...p, dedupeKey: dedupeKey(p) }));

/** Detect duplicate pool options (same topic+angle+imageVariant). */
export function findPoolDuplicates(pool: PoolPost[]): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const p of pool) {
    const key = p.dedupeKey || dedupeKey(p);
    if (seen.has(key)) dups.push(p.id);
    seen.add(key);
  }
  return dups;
}

/**
 * Select 6 non-duplicate options from the pool. Skips any option that
 * would repeat a topic+angle+imageVariant already chosen.
 */
export function pickSix(pool: PoolPost[]): PoolPost[] {
  const chosen: PoolPost[] = [];
  const seen = new Set<string>();
  for (const p of pool) {
    const key = p.dedupeKey || dedupeKey(p);
    if (seen.has(key)) continue; // duplicate prevention
    chosen.push(p);
    seen.add(key);
    if (chosen.length === 6) break;
  }
  return chosen;
}

/**
 * Built-in default schedule.
 *
 * Images are referenced from `/public/images` (originals copied from the
 * repo root JPEGs — never cropped, never resized, aspect ratio preserved).
 * Once Supabase is connected, captions + status are loaded from the
 * `social_posts` table and these become the seed/fallback values.
 */
export const DEFAULT_POSTS: Post[] = [
  {
    id: "post-1",
    date: "2026-08-10",
    platform: "Instagram",
    caption:
      "🐜 Protecting Coffs Harbour homes year-round. Book your general pest treatment today — call Cristian on 0449 252 963. #CoffsCoastPestControl #PestFreeHome",
    image: "/images/p1.jpg",
    status: "Draft",
  },
  {
    id: "post-2",
    date: "2026-08-11",
    platform: "Facebook",
    caption:
      "Did you know termites cause more damage than fire each year in Australia? Stay ahead with an AS 3660 compliant termite inspection. ☎️ 0449 252 963",
    image: "/images/p2.jpg",
    status: "Draft",
  },
  {
    id: "post-3",
    date: "2026-08-12",
    platform: "Facebook",
    caption:
      "Rodent-free means rest easy. Discreet, effective rodent control across the Coffs Coast. ABN 95 610 493 013. Message us to book a spring clean treatment.",
    image: "/images/p3.jpg",
    status: "Draft",
  },
  {
    id: "post-4",
    date: "2026-08-13",
    platform: "Instagram",
    caption:
      "Your local, family-run pest experts 🏡 Coffs Harbour, Woolgoolga, Sawtell & beyond. Free quotes — call 0449 252 963 today!",
    image: "/images/p4.jpg",
    status: "Draft",
  },
  {
    id: "post-5",
    date: "2026-08-14",
    platform: "Google Business Profile",
    caption:
      "Loved by our local customers ⭐ Friendly, thorough and reliable pest control. If you've used our service, we'd be grateful for your Google review!",
    image: "/images/p5.jpg",
    status: "Draft",
  },
  {
    id: "post-6",
    date: "2026-08-15",
    platform: "Facebook",
    caption:
      "Spider season is coming 🕷️ Put the kettle on and leave the web-work to us. General pest + spider treatment, one call: 0449 252 963.",
    image: "/images/p6.jpg",
    status: "Draft",
  },
  /* Mixed-media entries — short-form branded videos (.mp4). These render
     with the HTML5 <video> player + watermark shell. Replace the .mp4
     paths once real branded videos are staged in /public/media. */
  {
    id: "post-7",
    date: "2026-08-17",
    platform: "Instagram",
    caption:
      "Watch how an AS 3660 compliant termite inspection protects your home — 30-second rundown with Cristian. ☎️ 0449 252 963",
    image: "/images/p2.jpg",
    mediaType: "video",
    mediaUrl: "/media/termite-inspection.mp4",
    status: "Draft",
  },
  {
    id: "post-8",
    date: "2026-08-19",
    platform: "Facebook",
    caption:
      "Rodent control in action 🎥 Discreet, effective, and finished in one visit. Book today — 0449 252 963.",
    image: "/images/p3.jpg",
    mediaType: "video",
    mediaUrl: "/media/rodent-control.mp4",
    status: "Draft",
  },
];
