import { TRPCClientError } from "@trpc/client";

export const MAX_QUERY_RETRIES = 4;

/**
 * Statuses where an automatic replay cannot change the answer: the request was
 * malformed, unauthorized, missing — or, for 409, in conflict with server
 * state that only a deliberate action (reload, operator fix) resolves.
 * Retrying a conflict just replays the same refusal with backoff, which the
 * user experiences as a hung spinner before the real error finally shows.
 */
const HTTP_STATUS_TO_NOT_RETRY = [400, 401, 403, 404, 409, 422, 431];

export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) {
    return false;
  }

  if (
    error instanceof TRPCClientError &&
    HTTP_STATUS_TO_NOT_RETRY.includes(
      (error.data as { httpStatus?: number } | undefined)?.httpStatus ?? 0,
    )
  ) {
    return false;
  }

  return true;
}
