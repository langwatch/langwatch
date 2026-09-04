/**
 * The shared guard every apiClient-backed service method funnels its
 * `{ data, error, response }` triplet through before returning.
 *
 * openapi-fetch answers a request with `data` on success and `error` on a
 * decline. But a response it cannot read at all — an empty body on a non-2xx
 * status, which is exactly what many reverse-proxy error pages and a 5xx with
 * `Content-Length: 0` answer with — sets NEITHER: openapi-fetch's own
 * empty-body short-circuit returns `{ data: undefined, error: undefined }`
 * without attempting to parse anything. Left unguarded, `return data` after
 * `if (error) …` resolves the promise with `undefined`, and the caller fails
 * far from the real cause with something like "Cannot read properties of
 * undefined" (D12).
 *
 * This throws the SAME typed error the service's own `handleApiError` raises
 * for a named failure, carrying the HTTP status (from `response`, falling
 * back to whatever the error body itself carries) and the operation name — an
 * unreadable body now fails exactly as loudly as a readable one.
 */
export interface UnwrapApiResultParams<T> {
  /** What was being attempted, e.g. `create evaluator`. */
  operation: string;
  /** The `data` half of the client's response triplet. */
  data: T | undefined;
  /** The `error` half of the client's response triplet. */
  error: unknown;
  /** The `response` half, when the client kept hold of it. */
  response?: Response;
  /** The service's own `handleApiError`, which throws its typed error. */
  onError: (operation: string, error: unknown, response?: Response) => never;
  /**
   * True for endpoints that legitimately answer with no body (204, HEAD).
   * `data` stays `undefined` in that case without tripping the guard.
   */
  allowEmpty?: boolean;
}

export function unwrapApiResult<T>({
  operation,
  data,
  error,
  response,
  onError,
  allowEmpty = false,
}: UnwrapApiResultParams<T>): T {
  if (error) onError(operation, error, response);
  if (data === undefined && !allowEmpty) onError(operation, error, response);
  return data as T;
}
