/**
 * The address carried from one door to the other, in the URL FRAGMENT.
 *
 * A fragment is the one part of a URL the browser keeps to itself. It is not
 * on the request line, so it reaches no access log, no proxy, no CDN, no error
 * report, and no `Referer` header on the way anywhere else. A query string is
 * the opposite of all six: `?email=someone@example.com` is written down by
 * every hop it passes, and on these two screens the address is the single
 * piece of personal data there is to write down.
 *
 * Nothing about the carry is load-bearing — it exists so somebody who clicks
 * "Sign up" after typing their address does not type it twice — so making it
 * unreadable to the server costs nothing at all.
 *
 * It is read once and then wiped from the address bar, which keeps it out of
 * session history and out of anything that later reads `location.href`
 * (browser telemetry reads exactly that, ADR-058). The cost is that a manual
 * refresh forgets it. That is the right way round: the prefill is a
 * convenience and the address is a person's.
 */

const KEY = "email";

/**
 * `/auth/signup`, carrying the callback in the query and the address in the
 * fragment.
 *
 * `URLSearchParams` writes the fragment as well as the query so the two halves
 * escape identically, and so a `+` in an address survives the round trip:
 * written raw it would come back as a space, which is the plus-tag bug in a
 * second costume.
 */
export function signUpHref({
  callbackUrl,
  email,
}: {
  callbackUrl?: string;
  email?: string | null;
}): string {
  const query = new URLSearchParams();
  if (callbackUrl) query.set("callbackUrl", callbackUrl);

  const fragment = new URLSearchParams();
  if (email) fragment.set(KEY, email);

  const queryPart = query.toString();
  const fragmentPart = fragment.toString();
  return `/auth/signup${queryPart ? `?${queryPart}` : ""}${
    fragmentPart ? `#${fragmentPart}` : ""
  }`;
}

/**
 * `/auth/forgot-password`, carrying the address in the fragment the same way.
 *
 * The link sits under the password field, so the person clicking it has just
 * typed the address the reset is for. Asking for it again on the next screen
 * was the one thing that screen did, and it is the screen somebody reaches
 * already annoyed.
 */
export function forgotPasswordHref({
  email,
}: {
  email?: string | null;
}): string {
  const fragment = new URLSearchParams();
  if (email) fragment.set(KEY, email);
  const fragmentPart = fragment.toString();
  return `/auth/forgot-password${fragmentPart ? `#${fragmentPart}` : ""}`;
}

/** The address the fragment carries, if this browser arrived holding one. */
export function readCarriedEmail(): string | undefined {
  if (typeof window === "undefined") return void 0;
  const fragment = window.location.hash.replace(/^#/, "");
  if (!fragment) return void 0;
  return new URLSearchParams(fragment).get(KEY) ?? void 0;
}

/**
 * Take the address back out of the address bar, having read it.
 *
 * `replaceState` rather than assigning `location.hash`: assigning would push a
 * history entry, so Back would walk through the address the wipe was for.
 */
export function forgetCarriedEmail(): void {
  if (typeof window === "undefined") return;
  if (!window.location.hash) return;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}
