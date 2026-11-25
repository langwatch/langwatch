/**
 * Address in URL fragment (not query); keeps personal data out of logs
 */

const KEY = "email";
/** Set when a sign-in was refused because the password must be replaced first. */
const RESET_REQUIRED_KEY = "reset";
const RESET_REQUIRED_VALUE = "required";

/**
 * /auth/signup with callback in query, address in fragment; URLSearchParams escapes both.
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

/** /auth/forgot-password with the address just typed in the fragment, never the query. */
export function forgotPasswordHref({
  email,
  resetRequired = false,
}: {
  email?: string | null;
  /** The sign-in was refused until the password is replaced; the screen says so. */
  resetRequired?: boolean;
}): string {
  const fragment = new URLSearchParams();
  if (email) fragment.set(KEY, email);
  if (resetRequired) fragment.set(RESET_REQUIRED_KEY, RESET_REQUIRED_VALUE);
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

/** Whether this browser arrived because its sign-in was refused until a new password is set. */
export function readCarriedResetRequirement(): boolean {
  if (typeof window === "undefined") return false;
  const fragment = window.location.hash.replace(/^#/, "");
  return new URLSearchParams(fragment).get(RESET_REQUIRED_KEY) === RESET_REQUIRED_VALUE;
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
