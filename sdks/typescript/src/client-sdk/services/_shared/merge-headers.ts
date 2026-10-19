/**
 * The service's default headers with the caller's laid over them, whichever
 * `HeadersInit` shape the caller passed.
 */
export function mergeHeaders(
  defaults: Record<string, string>,
  overrides: HeadersInit | undefined,
): Headers {
  const merged = new Headers(defaults);
  new Headers(overrides).forEach((value, key) => merged.set(key, value));
  return merged;
}
