/**
 * Address in URL fragment (not query); keeps personal data out of logs
 */

const KEY = "email";

/**
 * /auth/signup with callback in query, address in fragment; URLSearchParams escapes both
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
  return `/auth/signup${queryPart ? `?${queryPart}` : ""}${fragmentPart ? `#${fragmentPart}` : ""}`;
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
 * `replaceState` rather than assigning `location.hash`: assigning would push
 * a history entry, so Back would walk through the address the wipe was for.
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
