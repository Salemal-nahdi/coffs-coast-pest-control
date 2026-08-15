import { createHash } from "crypto";

const PASSWORD = process.env.PORTAL_PASSWORD || "";

/**
 * Constant-time-ish comparison to mitigate timing attacks on the
 * portal password. Returns a boolean.
 */
export function verifyPassword(candidate: string): boolean {
  if (!PASSWORD || !candidate) return false;
  const expected = createHash("sha256").update(PASSWORD).digest("hex");
  const actual = createHash("sha256").update(candidate).digest("hex");
  return expected.length === actual.length && expected === actual;
}

/**
 * Portal is considered password-protected (i.e. a password is set).
 */
export function hasPasswordSet(): boolean {
  return Boolean(PASSWORD);
}
