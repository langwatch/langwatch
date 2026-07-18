/**
 * Error text for a failed parse, with any echoed source removed.
 *
 * Lives here rather than beside one parser because every decode path that
 * touches a stored payload needs it: queue job envelopes and cached fold
 * state both hold tenant data, and both surface parse failures into logs and
 * span attributes.
 */
export const errText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * A parse failure's message, with any echoed source text removed.
 *
 * **This is a PII guard, not tidiness.** V8 quotes the offending input back at
 * you: `JSON.parse("patient@hospital.example …")` throws
 * `Unexpected token 'p', "patient@ho"... is not valid JSON` — ten characters of
 * raw body. That message reaches the drop log (`GroupQueue.recordDrop` →
 * `err:`), and `redactStorageUrisInText` only strips storage URIs, so the
 * fragment would land in prod logs verbatim. The body is exactly the thing we
 * promised never to log (a staged payload can carry tenant PII), and it is the
 * thing we could not read anyway.
 *
 * Pre-dates this fix: the bare-JSON path already threw a raw `SyntaxError` that
 * #5736 then started logging. Fixed here rather than inherited (#5538).
 *
 * Keeps the diagnosis (`Unexpected token 'p'`, `Unterminated string`, position)
 * and drops only the quoted echo. zlib messages ("incorrect header check")
 * never echo input, so they pass through untouched.
 */
export const safeParseErrText = (err: unknown): string => {
  const raw = errText(err);
  // ALLOWLIST, not blocklist: keep the leading diagnosis and drop everything from
  // the first delimiter a parser uses to hand input back — `"` (V8's echo, quoted
  // or truncated) or `[`/`{` (msgpackr's `{"type":"Buffer","data":[83,69]}`, whose
  // byte array decodes straight back to the plaintext).
  //
  // Matching V8's exact wording instead was the first attempt and it leaked: V8
  // only appends `"..."` at ~21+ chars and echoes the WHOLE string below that, so
  // a 9-digit SSN or a 6-digit OTP sailed through untouched. A blocklist over one
  // library's message shapes re-opens on every runtime upgrade — the same
  // fragility `DecodeFailureReason` exists to avoid for classification.
  //
  // What survives the cut is vocabulary, not payload: "Unexpected token 'x'",
  // "Unterminated string in JSON at position 30", "incorrect header check". The
  // single-quoted token is one character — kept because it is the most useful
  // byte in the message and one character is not a secret.
  const cut = raw.search(/["[{]/);
  const head = (cut === -1 ? raw : raw.slice(0, cut)).trim().replace(/[,\s]+$/, "");
  const name = err instanceof Error ? err.name : "Error";
  return head ? `${name}: ${head}` : name;
};

