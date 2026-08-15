import { NextResponse } from "next/server";
import { notifyClientReady } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * POST /api/notify — trigger the monthly "content ready for review"
 * notification (n8n webhook or SMTP). Optionally accepts { to }.
 * Safe to call from a cron/Vercel schedule and custom manual buttons.
 */
export async function POST(req: Request) {
  let body: { to?: string; month?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  const result = await notifyClientReady({
    to: body.to,
    month: body.month ? new Date(body.month) : undefined,
  });

  return NextResponse.json(result, { status: result.sent ? 200 : 200 });
}
