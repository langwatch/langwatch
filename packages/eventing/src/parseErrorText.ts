/**
 * Error text for a failed parse, with echoed source removed (PII guard).
 */
export const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Parse failure message with echoed source removed (PII guard for V8 JSON errors).
 * Keeps diagnosis, drops quoted echo per ADR.
 */
export const safeParseErrText = (err: unknown): string => {
  const raw = errText(err);
  // Allowlist: keep diagnosis, drop first delimiter (V8's `"` echo or msgpackr's `[`/`{`)
  const cut = raw.search(/["[{]/);
  const head = (cut === -1 ? raw : raw.slice(0, cut)).trim().replace(/[,\s]+$/, "");
  const name = err instanceof Error ? err.name : "Error";
  return head ? `${name}: ${head}` : name;
};
