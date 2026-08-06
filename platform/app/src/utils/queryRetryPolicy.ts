import { TRPCClientError } from "@trpc/client";

import { isPermanentFailure } from "~/features/errors/logic/retryability";

export const MAX_QUERY_RETRIES = 4;

/**
 * Statuses where an automatic replay cannot change the answer: the request was
 * malformed, unauthorized, or aimed at something that is not there.
 *
 * 409 is deliberately absent. A conflict is the one 4xx that regularly IS
 * transient — a resource being written concurrently, a provider record that
 * settles a second later, a link written by a webhook that has not arrived
 * yet. Permanent conflicts are excluded by `isPermanentFailure`, which reads
 * the handled error's code, because that is where the distinction actually
 * lives.
 */
const HTTP_STATUS_TO_NOT_RETRY = [400, 401, 403, 404, 422, 431];

export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) {
    return false;
  }

  if (isPermanentFailure(error)) {
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
