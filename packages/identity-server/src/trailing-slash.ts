/**
 * Drop trailing slashes from an address, so the same issuer or base URL typed
 * two ways resolves to one string.
 *
 * A scan rather than `replace(/\/+$/, "")`: both inputs here are
 * customer-typed (an issuer, a deployment base URL), and that regex is
 * quadratic on a string of many slashes that fails to anchor — the engine
 * retries the run from every position (CodeQL js/polynomial-redos).
 */
export function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end -= 1;
  return value.slice(0, end);
}
