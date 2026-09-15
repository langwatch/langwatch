/**
 * What went wrong in a passkey ceremony, in a code the client registry has
 * words for.
 *
 * A WebAuthn ceremony's failures arrive from the browser and the plugin, not
 * from our own REST boundary: a thrown `DOMException`, or the plugin's own
 * `{ code, status }` shape. Neither is something `readHandledError` can read
 * — it wants the flat `{ error: "<code>" }` a REST boundary sends — so handed
 * on raw, every one of them fell through to the generic unknown line
 * ("Something went wrong. We've been notified."). That line is for failures
 * we could not anticipate, and a passkey attempt fails in exactly two ways
 * worth telling apart, both with registered copy already.
 *
 * Shared rather than declared per call site: the sign-up button, the sign-in
 * button, and the address field's own autofill offer all reach the same
 * ceremony, and disagreeing about the mapping between them is how the same
 * refusal used to read differently depending on which one raised it.
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
 * The `code` off a resolved client error, where it carried one.
 *
 * The client types a resolved ceremony's error as "a code, or not" depending
 * on which leg failed — a WebAuthn-side failure always names one, a plain
 * network failure never reaches far enough to — so it has to be asked for
 * rather than read directly off a union that does not always have it.
 */
export function readPasskeyErrorCode(error: object): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : void 0;
}

/**
 * The same, from whatever the client actually handed back for a ceremony that
 * RESOLVED (as opposed to threw).
 *
 * A ceremony that never reached the server has no status to read, and a
 * `status` of 0 is that case wearing a number — so both mean "we cannot tell
 * these apart", which is what `undefined` says here.
 */
export function passkeyFailureFrom(error: { status?: number } | null | undefined): {
  error: string;
} {
  const status = error?.status;
  return passkeyFailure(status === 0 ? void 0 : status);
}

/**
 * Nobody finished this ceremony, so nobody is owed an error.
 *
 * A ceremony ends unfinished in ways WebAuthn deliberately reports the same
 * way it reports "no credential matched" — a dismissed sheet, a superseded
 * request, a screen that went away — so that watching the prompt tells an
 * attacker nothing. None of those is an event a person needs telling about:
 * they either decided this, or they were already somewhere else.
 *
 * The plugin does NOT throw an abandoned ceremony: it RESOLVES it, carrying a
 * `code` of `ERROR_CEREMONY_ABORTED` and a `status` of 400 — a refusal's
 * clothes on something the server never saw. That is why this is asked about
 * the resolved shape's `code` rather than about a thrown exception's `name`
 * alone; a caller with only a `name` to offer (a raw `DOMException`) may pass
 * that instead.
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
  return code === "ERROR_CEREMONY_ABORTED" || name === "AbortError" || name === "NotAllowedError";
}
