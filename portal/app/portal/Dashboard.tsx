"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Post } from "@/lib/posts";
import { browserSupabase } from "@/lib/browserSupabase";
import { POSTS_TABLE } from "@/lib/postsStore";

type SaveState = Record<string, "idle" | "saving" | "saved" | "error">;

const platformStyles: Record<string, string> = {
  Facebook: "bg-[#1877F2] text-white",
  Instagram: "bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-white",
  "Google Business Profile": "bg-[#4285F4] text-white",
};

export default function Dashboard({ initialPosts }: { initialPosts: Post[] }) {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [saveState, setSaveState] = useState<SaveState>({});
  const [manualEdit, setManualEdit] = useState<Record<string, string>>({});
  const [supabaseReady, setSupabaseReady] = useState(!!browserSupabase);
  // Latest approved-asset bundle (ZIP) for the download card.
  const [latestZip, setLatestZip] = useState<{
    name: string;
    url: string;
    size: number;
    created: string;
  } | null>(null);
  const [zipAvailable, setZipAvailable] = useState(false);

  // Fetch the latest generated asset bundle so the client can grab it anytime.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/zips", { cache: "no-store" });
        const data = await res.json();
        if (data?.latest) setLatestZip(data.latest);
        setZipAvailable(!!data?.available);
      } catch {
        setZipAvailable(false);
      }
    })();
  }, []);

  // Keep the edit buffer in sync once posts load from the DB.
  useEffect(() => {
    setManualEdit((prev) => {
      const next = { ...prev };
      posts.forEach((p) => {
        if (next[p.id] === undefined) next[p.id] = p.caption;
      });
      return next;
    });
  }, [posts]);

  const refreshPosts = useCallback(async () => {
    try {
      const res = await fetch("/api/posts", { cache: "no-store" });
      const data = await res.json();
      if (data?.posts) {
        setPosts(data.posts);
        setSupabaseReady(!!browserSupabase);
      }
    } catch {
      /* keep current state */
    }
  }, []);

  async function saveCaption(postId: string) {
    const caption = manualEdit[postId];
    if (caption === undefined) return;

    // Optimistic local update.
    setSaveState((s) => ({ ...s, [postId]: "saving" }));
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, caption } : p))
    );

    try {
      if (browserSupabase) {
        const { error } = await browserSupabase
          .from(POSTS_TABLE)
          .update({ caption })
          .eq("id", postId);
        if (error) throw error;
      } else {
        // No Supabase configured — fall back to the server route.
        const res = await fetch(`/api/posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caption }),
        });
        if (!res.ok) throw new Error("update failed");
      }
      setSaveState((s) => ({ ...s, [postId]: "saved" }));
      setTimeout(() => setSaveState((s) => ({ ...s, [postId]: "idle" })), 2000);
    } catch {
      setSaveState((s) => ({ ...s, [postId]: "error" }));
      setTimeout(() => setSaveState((s) => ({ ...s, [postId]: "idle" })), 3000);
    }
  }

  async function approvePost(postId: string) {
    setSaveState((s) => ({ ...s, [postId]: "saving" }));
    try {
      if (browserSupabase) {
        const { error } = await browserSupabase
          .from(POSTS_TABLE)
          .update({
            status: "Approved",
            flagged_for_review: true,
            approved_at: new Date().toISOString(),
          })
          .eq("id", postId);
        if (error) throw error;
      } else {
        const res = await fetch(`/api/posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Approved" }),
        });
        if (!res.ok) throw new Error("approve failed");
      }
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, status: "Approved" } : p))
      );
      setSaveState((s) => ({ ...s, [postId]: "saved" }));
      setTimeout(() => setSaveState((s) => ({ ...s, [postId]: "idle" })), 2000);
    } catch {
      setSaveState((s) => ({ ...s, [postId]: "error" }));
      setTimeout(() => setSaveState((s) => ({ ...s, [postId]: "idle" })), 3000);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  /** Copy the post caption to the clipboard (works for image & video posts). */
  async function copyCaption(post: Post) {
    const text = manualEdit[post.id] ?? post.caption ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setSaveState((s) => ({ ...s, [post.id]: "saved" }));
      setTimeout(() => setSaveState((s) => ({ ...s, [post.id]: "idle" })), 1500);
    } catch {
      /* fallback for older browsers */
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setSaveState((s) => ({ ...s, [post.id]: "saved" }));
      setTimeout(() => setSaveState((s) => ({ ...s, [post.id]: "idle" })), 1500);
    }
  }

  /** Download the asset for a post — handles both images and .mp4 videos. */
  async function downloadAsset(post: Post) {
    const isVideo = post.mediaType === "video";
    const url = isVideo ? post.mediaUrl || post.image : post.image;
    if (!url) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      // Prefer a meaningful filename: derive from the source path.
      const srcName = url.split("/").pop() || `post-${post.id}`;
      a.download = isVideo ? srcName.replace(/\.[^.]+$/, "") + ".mp4" : srcName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      /* fallback: open asset in a new tab */
      window.open(url, "_blank");
    }
  }

  const approvedCount = posts.filter((p) => p.status === "Approved").length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <header className="flex items-center justify-between mb-8 border-b border-neutral-800 pb-6">
        <div className="flex items-center gap-4">
          <div className="logo-black-shell rounded-xl w-14 h-14 overflow-hidden">
            <Image
              src="/images/logo-no-background.png"
              alt="Coffs Coast Pest Control logo"
              width={56}
              height={56}
              className="w-full h-full object-contain"
            />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Content Calendar</h1>
            <p className="text-sm text-neutral-400">
              Review, edit & approve your scheduled posts.
            </p>
          </div>
        </div>
        <button
          onClick={logout}
          className="text-sm px-4 py-2 rounded-lg border border-neutral-700 hover:border-white transition"
        >
          Log out
        </button>
      </header>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Stat label="Total Posts" value={String(posts.length)} />
        <Stat label="Approved" value={String(approvedCount)} accent="text-green-400" />
        <Stat
          label="Publishing"
          value={supabaseReady ? "Connected" : "Demo Mode"}
          accent={supabaseReady ? "text-emerald-400" : "text-amber-400"}
        />
      </div>

      {/* Approved asset bundle download card */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 mb-8 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-black flex items-center justify-center text-2xl">
            📦
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-white">Approved Asset Bundle</p>
            <p className="text-sm text-neutral-400 truncate">
              {zipAvailable && latestZip
                ? `Latest bundle · ${latestZip.name} · ${(latestZip.size / 1024 / 1024).toFixed(1)} MB`
                : "No bundle generated yet — run the monthly batch or the on-demand test."}
            </p>
          </div>
        </div>
        {zipAvailable && latestZip ? (
          <a
            href={latestZip.url}
            download
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-neutral-200 transition"
          >
            ⬇ Download ZIP
          </a>
        ) : (
          <span className="ml-auto inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-400">
            Not available yet
          </span>
        )}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {posts.map((post) => {
          const status = saveState[post.id] || "idle";
          return (
            <article
              key={post.id}
              className={`rounded-2xl overflow-hidden border bg-neutral-900 transition ${
                post.status === "Approved"
                  ? "border-green-500/60"
                  : "border-neutral-800"
              }`}
            >
              {/* Media preview — images use cover-preserving <img>; videos use
                  an HTML5 player with graceful fallback. Option C: if a video
                  has no media_url yet (pending montage) or its file fails to
                  load (404), we show the poster image + "Video coming soon"
                  placeholder instead of a broken player. Original asset is
                  never cropped/distorted, and the logo watermark renders on
                  the solid black shell. */}
              <div className="relative aspect-square w-full bg-black overflow-hidden">
                {post.mediaType === "video" ? (
                  <VideoMedia
                    src={post.mediaUrl}
                    poster={post.image}
                    date={post.date}
                  />
                ) : (
                  <Image
                    src={post.image}
                    alt={`Scheduled post ${post.date}`}
                    fill
                    className="post-image object-cover"
                    sizes="(max-width: 768px) 100vw, 33vw"
                  />
                )}
                {/* Logo watermark — bottom-right, on solid black shell,
                    never crops/distorts the source image */}
                <div className="post-watermark">
                  <Image
                    src="/images/logo-no-background.png"
                    alt=""
                    aria-hidden
                    width={38}
                    height={38}
                    className="w-full h-full object-contain"
                  />
                </div>
                <span className="absolute top-3 left-3 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-black/70 text-white backdrop-blur">
                  {post.date}
                </span>
                <span
                  className={`absolute top-3 right-3 text-[11px] font-semibold px-2.5 py-1 rounded-full ${platformStyles[post.platform] || "bg-neutral-600 text-white"}`}
                >
                  {post.platform}
                </span>
                {post.mediaType === "video" && (
                  <span className="absolute bottom-3 right-14 rounded-md bg-black/60 text-[10px] font-bold px-2 py-0.5 text-white">
                    ▶ Video
                  </span>
                )}
              </div>

              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      post.status === "Approved"
                        ? "bg-green-500/20 text-green-400"
                        : "bg-neutral-700 text-neutral-300"
                    }`}
                  >
                    {post.status}
                  </span>
                  {post.status === "Approved" && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-yellow-500/20 text-yellow-400">
                      Flagged for review
                    </span>
                  )}
                </div>

                {/* Editable caption */}
                <label className="block text-xs font-medium text-neutral-400 uppercase tracking-wide">
                  Caption (editable)
                </label>
                <textarea
                  value={manualEdit[post.id] ?? post.caption}
                  onChange={(e) =>
                    setManualEdit((prev) => ({
                      ...prev,
                      [post.id]: e.target.value,
                    }))
                  }
                  rows={5}
                  className="w-full px-3 py-2 rounded-lg bg-black border border-neutral-700 text-white text-sm leading-relaxed resize-y outline-none focus:border-white"
                  placeholder="Write your caption…"
                />

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyCaption(post)}
                    className="flex-1 py-2 rounded-lg border border-neutral-700 text-white text-sm font-medium hover:border-white transition"
                    title="Copy caption to clipboard"
                  >
                    📋 Copy
                  </button>
                  <button
                    onClick={() => downloadAsset(post)}
                    className="flex-1 py-2 rounded-lg border border-neutral-700 text-white text-sm font-medium hover:border-white transition"
                    title="Download image or video asset"
                  >
                    ⬇ Download
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => saveCaption(post.id)}
                    disabled={status === "saving"}
                    className="flex-1 py-2 rounded-lg border border-neutral-700 text-white text-sm font-medium hover:border-white transition disabled:opacity-60"
                  >
                    {status === "saving" ? <span className="spinner" /> : "Save caption"}
                  </button>
                  {post.status !== "Approved" && (
                    <button
                      onClick={() => approvePost(post.id)}
                      disabled={status === "saving"}
                      className="flex-1 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-neutral-200 transition disabled:opacity-60"
                    >
                      Approve
                    </button>
                  )}
                  {post.status === "Approved" && (
                    <span className="flex-1 py-2 rounded-lg bg-green-500/20 text-green-400 text-sm font-semibold text-center">
                      Approved ✓
                    </span>
                  )}
                </div>

                {status === "saved" && (
                  <p className="text-xs text-green-400">Saved ✓</p>
                )}
                {status === "error" && (
                  <p className="text-xs text-red-400">Could not save. Try again.</p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <p className="text-center text-xs text-neutral-500 mt-10">
        Changes sync to Supabase. Approved posts are flagged for final review
        before publishing.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl bg-neutral-900 border border-neutral-800 p-4">
      <p className="text-xs text-neutral-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${accent || "text-white"}`}>{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------
 * Option C — graceful video handling.
 *
 * A post marked mediaType='video' can be in one of three states:
 *   1. RENDERED   — media_url present AND the file exists -> play it.
 *   2. PENDING    — media_url blank/null (montage not yet rendered) ->
 *                   show poster image + "Video coming soon".
 *   3. BROKEN     — media_url points at a file that 404s -> onError falls
 *                   back to the poster + "Video coming soon".
 * In every non-playable state we degrade to the poster image so the card
 * never shows a broken player and the browser never hard-fails.
 * ------------------------------------------------------------------ */
function VideoMedia({
  src,
  poster,
  date,
}: {
  src?: string;
  poster: string;
  date: string;
}) {
  const [failed, setFailed] = useState(false);
  // No real file yet (pending montage render) -> show placeholder directly.
  const showPlaceholder = !src;

  if (showPlaceholder || failed) {
    return <VideoPlaceholder poster={poster} date={date} />;
  }

  return (
    <>
      {/* Hidden preflight image only used to mask player while loading */}
      <div className="absolute inset-0">
        <Image
          src={poster}
          alt={`Scheduled post ${date}`}
          fill
          className="post-image object-cover"
          sizes="(max-width: 768px) 100vw, 33vw"
        />
      </div>
      <video
        src={src}
        controls
        preload="metadata"
        playsInline
        onError={() => setFailed(true)}
        className="relative z-10 w-full h-full object-contain"
      />
    </>
  );
}

/* Shared fallback: poster image under a subtle "Video coming soon" badge. */
function VideoPlaceholder({
  poster,
  date,
}: {
  poster: string;
  date: string;
}) {
  return (
    <div className="relative w-full h-full">
      <Image
        src={poster}
        alt={`Scheduled post ${date}`}
        fill
        className="post-image object-cover"
        sizes="(max-width: 768px) 100vw, 33vw"
      />
      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
        <span className="rounded-lg bg-black/70 text-white text-[11px] font-bold px-3 py-1.5 flex items-center gap-1.5">
          🎬 Video coming soon
        </span>
      </div>
    </div>
  );
}
