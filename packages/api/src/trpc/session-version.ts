/**
 * The session version every tRPC answer carries, and the content ETag a session or
 * reference read revalidates by (dev/docs/adr/164-browser-query-cache-tiers.md).
 */
import { createHash } from "node:crypto";

export const SESSION_VERSION_HEADER = "x-lw-session-version";

/** Where a caller's session version is read; the authz module answers it. */
export type TrpcSessionVersions = Readonly<{
  getSessionVersion(input: { userId: string }): Promise<number>;
}>;

/** A strong hash of an answer, prefixed with the user so no user's version matches another's. */
export function contentVersion({
  userId,
  body,
}: {
  userId: string;
  body: string | Uint8Array;
}): string {
  return `${userId}.${createHash("sha256").update(body).digest("base64url")}`;
}

/** The content version as an ETag. */
export function contentEtag({ userId, body }: { userId: string; body: Uint8Array }): string {
  return `"${contentVersion({ userId, body })}"`;
}

/** `*` never matches: a tag must name this user and this body. */
export function holdsEtag({ ifNoneMatch, etag }: { ifNoneMatch: string | null; etag: string }) {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .includes(etag);
}

/** The dotted procedure paths one request names; an encoded one matches nothing. */
export function trpcRequestPaths({ request, endpoint }: { request: Request; endpoint: string }) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(`${endpoint}/`)) return [];
  return pathname
    .slice(endpoint.length + 1)
    .split(",")
    .filter((path) => path.length > 0);
}
