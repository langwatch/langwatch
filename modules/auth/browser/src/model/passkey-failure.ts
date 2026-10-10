/**
 * Maps a passkey ceremony's failure to a code the client registry has words
 * for — raw WebAuthn/plugin shapes aren't what `readHandledError` reads.
 * Shared across sign-up, sign-in and autofill so all three agree.
 */
export function passkeyFailure(status: number | undefined): { error: string } {
  // The server looked at the credential and said no. Same answer whether it
  // belongs to somebody else or to nobody — the endpoint does not say which.
  const refused = status === 400 || status === 401 || status === 403;
  return {
    error: refused ? "identity_passkey_not_recognized" : "identity_passkey_ceremony_failed",
  };
}

/**
 * The `code` off a resolved client error, where it carried one. The client
 * types this as "a code, or not" depending on which leg failed — WebAuthn
 * always names one, a network failure never reaches far enough to.
 */
export function readPasskeyErrorCode(error: object): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : void 0;
}

/**
 * The same, from a ceremony that RESOLVED (not threw). Never reaching the
 * server means no status, and `status: 0` is that case wearing a number —
 * both mean "can't tell", which is what `undefined` says here.
 */
export function passkeyFailureFrom(error: { status?: number; code?: unknown } | null | undefined): {
  error: string;
} {
  const status = error?.status;
  if (failedInBrowser({ code: error?.code })) return passkeyFailure(void 0);
  return passkeyFailure(status === 0 ? void 0 : status);
}

/**
 * The plugin stamps 400 on a ceremony that failed in this browser too, so the code tells: its own
 * `AUTH_CANCELLED` or a WebAuthn `ERROR_*` code means no credential ever reached the server.
 */
export function failedInBrowser({ code }: { code?: unknown }): boolean {
  return typeof code === "string" && (code === "AUTH_CANCELLED" || code.startsWith("ERROR_"));
}

/**
 * Nobody finished this ceremony, so nobody is owed an error — WebAuthn
 * deliberately reports a dismissed sheet the same as "no match" so the
 * prompt tells an attacker nothing. The plugin RESOLVES this as 400, not a throw.
 */
export function isCeremonyAbandoned({
  code,
  name,
}: {
  /** The plugin's own code, from a ceremony that resolved rather than threw. */
  code?: string;
  /** A thrown `DOMException`'s name — the platform's own word for it. */
  name?: string;
}): boolean {
  // The WebAuthn client passes a NotAllowedError (dismissed, timed out, no credential) through
  // under its own code once the plugin has resolved it.
  return (
    code === "ERROR_CEREMONY_ABORTED" ||
    code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" ||
    name === "AbortError" ||
    name === "NotAllowedError"
  );
}
