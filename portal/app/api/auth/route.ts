import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasPasswordSet, verifyPassword } from "@/lib/auth";

const SESSION_COOKIE = "portal_session";
const YEAR = 60 * 60 * 24 * 365;

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));

  // If no password is configured at all, allow open access.
  if (!hasPasswordSet()) {
    const res = NextResponse.json({ ok: true, open: true });
    return res;
  }

  if (!verifyPassword(String(password ?? ""))) {
    return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  const store = cookies();
  store.set(SESSION_COOKIE, "authorized", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: YEAR,
  });
  return res;
}

export async function GET() {
  // Lightweight check used by the client to decide where to route.
  const store = cookies();
  const authed = store.get(SESSION_COOKIE)?.value === "authorized" || !hasPasswordSet();
  return NextResponse.json({ authorized: authed });
}
