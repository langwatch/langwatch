/**
 * The shared guard every apiClient-backed service method funnels its `{ data, error,
 * response }` triplet through before returning.
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
