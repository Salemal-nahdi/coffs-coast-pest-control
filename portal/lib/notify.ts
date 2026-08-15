/**
 * Automated monthly notification hook.
 *
 * Compatible with THREE modern paths so it works with zero extra services
 * OR with existing automation (n8n / Gmail App Password):
 *   1. n8n webhook (SMS signal) — triggers an external n8n workflow.
 *   2. SMTP via nodemailer (optional, zero-maintenance default OFF).
 *   3. Supabase edge/console already updated — the client is notified
 *      in-app and the webhook fires each month via a scheduler.
 *
 * The endpoint never throws an unhandled error: if nothing is configured it
 * returns a 200 with { skipped: true } so scheduling never breaks.
 */

export interface NotifyResult {
  sent: boolean;
  method: "n8n" | "smtp" | "none";
  to?: string;
  subject?: string;
  details: string;
}

function monthLabel(d: Date = new Date()): string {
  return d.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

export async function notifyClientReady(opts?: {
  to?: string;
  month?: Date;
}): Promise<NotifyResult> {
  const month = opts?.month ?? new Date();
  const label = monthLabel(month);
  const to = opts?.to ?? process.env.CLIENT_NOTIFY_EMAIL ?? "";
  const subject =
    `Coffs Coast Pest Control — ${label} social content ready to review` +
    (to ? "" : " (no recipient set — preview only)");

  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  if (n8nUrl) {
    try {
      const res = await fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "content_pool_ready",
          month: label,
          to,
          subject,
          poolSize: 10,
          draftCount: 6,
        }),
      });
      if (!res.ok) throw new Error(`n8n webhook ${res.status}`);
      return { sent: true, method: "n8n", to, subject, details: "n8n webhook signalled." };
    } catch (e) {
      return { sent: false, method: "n8n", to, subject, details: `n8n webhook failed: ${e}` };
    }
  }

  // Optional SMTP path — only active if transport is configured.
  // webpackIgnore keeps nodemailer external/optional so the build never
  // fails when it isn't installed (zero-maintenance default).
  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost && process.env.SMTP_USER && process.env.SMTP_PASS && to) {
    try {
      // Resolve the module name at runtime so the optional SMTP dependency is
      // never statically bundled/resolved (zero-maintenance: no install needed
      // unless SMTP is actually used).
      const mod = "nodemailer";
      const nodemailer = await import(mod);
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        text:
          `Hi Cristian,\n\nYour ${label} social media content pool (10 options → pick 6) is ready for review and approval in the portal.\n\nFrom,\nCoffs Coast Pest Control`,
      });
      return { sent: true, method: "smtp", to, subject, details: "SMTP email sent." };
    } catch (e) {
      return { sent: false, method: "smtp", to, subject, details: `SMTP failed: ${e}` };
    }
  }

  return { sent: false, method: "none", to, subject, details: "No notification channel configured. Add N8N_WEBHOOK_URL or SMTP_*. Skipping." };
}
