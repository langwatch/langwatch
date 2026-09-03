/**
 * What went wrong in a passkey ceremony, in a code the registry has words for.
 *
 * The ceremony's failures arrive from the WebAuthn client, which knows nothing
 * about our error vocabulary: a `DOMException` from the browser, or the
 * plugin's own `{ code, status }`. Neither is a shape `readHandledError` can
 * read — it wants the flat `{ error: "<code>" }` a REST boundary sends — so
 * handed on as they are, every one of them resolved to the generic unknown
 * line ("Something went wrong. We've been notified."). That line is for
 * failures we could not anticipate, and this is not one of them: a passkey
 * attempt fails in two ways worth telling apart, and both have had registered
 * copy all along.
 *
 * This lives beside the screens rather than inside one of them because BOTH
 * ways into a ceremony end here — the button on the rail, and the offer that
 * rides in the address field's own autofill. They used to disagree: the button
 * mapped its failures and the autofill offer passed them straight through, so
 * the same refusal said "That passkey isn't one we recognize" from one route
 * and "We've been notified" from the other.
 */
export function passkeyFailure(status: number | undefined): { error: string } {
  // The server looked at the credential and said no. Same answer whether it
  // belongs to somebody else or to nobody — the endpoint does not say which.
  const refused = status === 400 || status === 401 || status === 403;
  return {
    error: refused
      ? "identity_passkey_not_recognized"
      : "identity_passkey_ceremony_failed",
  };
}

/**
 * The same, from whatever the client actually handed back.
 *
 * A ceremony that never reached the server has no status to read, and a
 * `status` of 0 is that case wearing a number — so both mean "we cannot tell
 * these apart", which is what `undefined` says here.
 */
export function passkeyFailureFrom(error: unknown): { error: string } {
  const status = (error as { status?: unknown } | null)?.status;
  return passkeyFailure(
    typeof status === "number" && status !== 0 ? status : void 0,
  );
}

/**
 * Nobody finished this ceremony, so nobody is owed an error.
 *
 * A ceremony ends unfinished in three indistinguishable ways — the sheet was
 * dismissed, the request was superseded, the screen went away — and WebAuthn
 * reports all of them the way it reports "no credential matched",
 * deliberately, so that watching the prompt tells an attacker nothing. None is
 * an event a person needs telling about: they either decided this, or they
 * were already somewhere else.
 *
 * Two shapes carry it, which is why it is read in one place. The browser
 * throws a `DOMException` named `AbortError` or `NotAllowedError`. The plugin
 * catches that same throw on its way out of the ceremony and RESOLVES it
 * instead, as `ERROR_CEREMONY_ABORTED` carrying a status of 400 — a refusal's
 * clothes on something the server never saw.
 *
 * That second shape is how a SUCCESSFUL password sign-in ended in a passkey
 * alert. The offer pending in the address field has no abort handle, so the
 * navigation away tears the ceremony down, the plugin resolves it as a 400,
 * and 400 is the status that means "the server looked at this credential and
 * said no" — so the screen said "That passkey isn't one we recognize" for the
 * split second before the next document committed.
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
  return (
    code === "ERROR_CEREMONY_ABORTED" ||
    name === "AbortError" ||
    name === "NotAllowedError"
  );
}
