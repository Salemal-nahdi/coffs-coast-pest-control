import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasPasswordSet } from "@/lib/auth";
import { getPosts, mergePosts } from "@/lib/postsStore";
import {
  Post,
  DEFAULT_POSTS,
  DEFAULT_POOL,
  generateMonthlyAssets,
  assignSchedule,
} from "@/lib/posts";
import Dashboard from "./Dashboard";
import PoolWorkflow from "./PoolWorkflow";

export const dynamic = "force-dynamic";

const SESSION_COOKIE = "portal_session";

export default async function PortalPage() {
  // Secure route wrapper: no password set OR valid session cookie required.
  const store = cookies();
  const session = store.get(SESSION_COOKIE)?.value === "authorized";

  if (hasPasswordSet() && !session) {
    redirect("/login");
  }

  // Expanded Generation Support: pull/generate a month's fresh assets and
  // map them onto the smart Tue/Thu schedule. Falls back gracefully to the
  // static brand bundle, so live DB rows (if any) are preserved.
  const count = DEFAULT_POSTS.length;
  const [live, generated] = await Promise.all([
    getPosts(),
    generateMonthlyAssets(count).catch(() => []),
  ]);

  const generatedAssets = generated ?? [];
  if (generatedAssets.length > 0) {
    // Assign smart monthly dates to generated assets (Tue/Thu cadence).
    const dates = assignSchedule(generatedAssets.length);
    const generatedPosts: Post[] = generatedAssets.map((g, i) => ({
      id: `gen-${g.id}`,
      date: dates[i] ?? "",
      platform: g.platform,
      caption: g.caption,
      image: g.src,
      status: "Draft",
    }));
    return (
      <>
        <Dashboard initialPosts={generatedPosts} />
        <PoolWorkflow basePool={DEFAULT_POOL} />
      </>
    );
  }

  // No generated content (static fallback) -> merge live DB rows over defaults.
  const posts = mergePosts(live);
  return (
    <>
      <Dashboard initialPosts={posts} />
      <PoolWorkflow basePool={DEFAULT_POOL} />
    </>
  );
}
