import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const SESSION_COOKIE = "portal_session";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  const store = cookies();
  store.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
