/** What the door does with one redirect Better Auth answered for a sign-in it would not link. */
type AccountNotLinkedRedirect = { kind: "pass" } | { kind: "rewrite"; location: string };

/** Better Auth's code when an address's account exists under a method it may not link. */
const ACCOUNT_NOT_LINKED = "account_not_linked";

/**
 * Names the connection that governs the address on a refused link, in `error_description` as the
 * organization bounce does, so the error screen can point at it
 * (specs/auth/sso-wrong-provider-recovery.feature).
 */
export function accountNotLinkedRedirectOf({
  location,
  connectionId,
}: {
  location: string | null;
  connectionId: string | undefined;
}): AccountNotLinkedRedirect {
  if (!location || connectionId === undefined) return { kind: "pass" };
  const absolute = /^https?:\/\//i.test(location);
  const target = parsedLocation(location);
  if (!target.parsed) return { kind: "pass" };
  const { url } = target;
  if (url.searchParams.get("error") !== ACCOUNT_NOT_LINKED) return { kind: "pass" };
  url.searchParams.set("error_description", connectionId);
  return {
    kind: "rewrite",
    location: absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`,
  };
}

/** Whether a redirect is Better Auth's refused link, so the door asks who governs the address. */
export function isAccountNotLinkedRedirect({ location }: { location: string | null }): boolean {
  if (!location) return false;
  const target = parsedLocation(location);
  return target.parsed && target.url.searchParams.get("error") === ACCOUNT_NOT_LINKED;
}

function parsedLocation(location: string): { parsed: true; url: URL } | { parsed: false } {
  try {
    return { parsed: true, url: new URL(location, "http://relative.invalid") };
  } catch {
    return { parsed: false };
  }
}
