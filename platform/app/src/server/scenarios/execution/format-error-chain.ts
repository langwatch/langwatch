/**
 * Flattens a thrown error and its chain into the single line the scenario child
 * process reports to its parent on stdout.
 *
 * This is the ONLY description of a failed run that survives the process
 * boundary: `scenario.processor.ts` reads it off stdout and
 * `classifyScenarioInfraError` turns it into the handled error the run drawer
 * renders. Whatever this function drops is gone — the child has already exited.
 *
 * It lives apart from `scenario-child-process.ts` because that module is an
 * entrypoint: importing it runs `main()`. A pure module can be tested.
 *
 * @see specs/scenarios/scenario-infra-error-surfacing.feature
 */

/**
 * The next link in an error chain.
 *
 * `cause` is the standard one, and the only one an undici TLS failure uses. The
 * AI SDK does not use it: `AI_RetryError` leaves `cause` undefined and keeps the
 * failure that actually ended the run on `lastError` (with every attempt in
 * `errors`). Following `cause` alone therefore stopped one link short of the
 * only link carrying the provider's status code and response body — which is
 * precisely the text the classifier needs to name the failure. A gateway 502
 * reached the classifier as the bare word "gateway_unavailable" for that
 * reason, and got classified as nothing.
 */
function nextInChain(error: Error): unknown {
  const candidate = error as {
    cause?: unknown;
    lastError?: unknown;
    errors?: unknown;
  };
  if (candidate.cause !== undefined && candidate.cause !== null) {
    return candidate.cause;
  }
  if (candidate.lastError !== undefined && candidate.lastError !== null) {
    return candidate.lastError;
  }
  // An aggregate's attempts are the same failure retried, so the last one is
  // the one that ended the run; the earlier ones add length, not signal.
  if (Array.isArray(candidate.errors) && candidate.errors.length > 0) {
    return candidate.errors[candidate.errors.length - 1];
  }
  return undefined;
}

/**
 * True when an earlier link already stated this text.
 *
 * Wrapping an error as `` new Error(`[${name}] ${error}`, { cause: error }) `` is
 * the common shape — it is what @langwatch/scenario does around every agent
 * call — and it puts the cause's full message inside the wrapper's own.
 * Appending it again produced the doubled sentence customers actually saw:
 * "Failed after 3 attempts. Last error: gateway_unavailable: Failed after 3
 * attempts. Last error: gateway_unavailable". On a deeper chain it spent the
 * message budget repeating the tail instead of reaching the useful end of it.
 */
function alreadyStated(part: string, earlier: string[]): boolean {
  return earlier.some((seen) => seen.includes(part));
}

/**
 * Flatten an error and its chain into a single string.
 *
 * Node's `fetch`/undici surface TLS and network failures as a generic
 * `TypeError: fetch failed` whose real reason (e.g. "self-signed certificate in
 * certificate chain", `SELF_SIGNED_CERT_IN_CHAIN`) lives on `error.cause`.
 * Reporting only `error.message` would drop that signal, so the parent — and
 * the failure classifier — would never see why the run died. Walk the chain and
 * include any error `code` so the classification is accurate.
 */
export function formatErrorWithCauses(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current)) {
    seen.add(current);
    if (!(current instanceof Error)) {
      parts.push(String(current));
      break;
    }
    const code = (current as { code?: unknown }).code;
    const text =
      typeof code === "string"
        ? `${current.message} (${code})`
        : current.message;
    if (text.length > 0 && !alreadyStated(text, parts)) {
      parts.push(text);
    }
    current = nextInChain(current);
  }

  return parts.join(": ");
}
