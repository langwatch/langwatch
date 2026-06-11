/**
 * Signed-state token for the Langy GitHub App OAuth round-trip.
 *
 * State carries (userId, organizationId, mode, returnTo, issuedAt, nonce)
 * signed HMAC-SHA256 with CREDENTIALS_SECRET. Encoded as `body.sig` in
 * base64url so it survives the URL.
 *
 * Pulled out of the route so the security-critical sign/verify pair can be
 * tested without bringing up the Hono app. Spec:
 * specs/assistant/langy-github-prs.feature. Issue: #4747.
 */
import { createHmac, timingSafeEqual } from "crypto";

export const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type GithubOauthStatePayload = {
  userId: string;
  organizationId: string;
  mode: "popup" | "redirect";
  returnTo: string;
  issuedAt: number;
  nonce: string;
};

export function signGithubOauthState(
  payload: GithubOauthStatePayload,
  signingKey: string,
): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", signingKey).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyGithubOauthState(
  token: string | null | undefined,
  signingKey: string,
  now: number = Date.now(),
): GithubOauthStatePayload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", signingKey).update(body).digest("base64url");
  const a = Buffer.from(sig, "base64url");
  const b = Buffer.from(expected, "base64url");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: GithubOauthStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as GithubOauthStatePayload;
  } catch {
    return null;
  }
  if (
    typeof payload?.userId !== "string" ||
    typeof payload?.organizationId !== "string" ||
    typeof payload?.issuedAt !== "number" ||
    (payload.mode !== "popup" && payload.mode !== "redirect")
  ) {
    return null;
  }
  if (now - payload.issuedAt > STATE_TTL_MS) return null;
  return payload;
}
