import { timingSafeEqual } from "node:crypto";

/**
 * The one comparison behind every internal route's shared secret, which is
 * their entire authentication. Fails CLOSED, because `header === secret` read
 * `undefined === undefined` as true and let anyone trigger destructive jobs.
 */
export function isInternalSecretValid({
  authorizationHeader,
  expected,
}: {
  authorizationHeader: string | undefined;
  expected: string | undefined;
}): boolean {
  if (!expected) return false;

  const presented = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : authorizationHeader;
  if (!presented) return false;

  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  if (presentedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(presentedBytes, expectedBytes);
}
