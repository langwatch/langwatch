/**
 * Answering an {@link IdempotentOutcome} on a Hono route.
 *
 * Shared by every family that accepts `Idempotency-Key`, so the marker header
 * is spelled once rather than per route.
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAY_HEADER,
  type IdempotentOutcome,
  MAX_KEY_LENGTH,
  MIN_KEY_LENGTH,
} from "~/server/api/idempotency";

/**
 * The `Idempotency-Key` request header, as the creates document it.
 *
 * Spelled once so the docs cannot drift from the behaviour: the bounds come
 * from the same constants the validator enforces.
 */
export const idempotencyKeyParameter = {
  name: IDEMPOTENCY_KEY_HEADER,
  in: "header",
  required: false,
  description:
    `A caller-chosen key, ${MIN_KEY_LENGTH} to ${MAX_KEY_LENGTH} characters, that makes this create safe to retry. ` +
    "The first request to use a key runs normally and its response is stored for 24 hours. " +
    `A later request with the same key and the same body is not executed again: it returns the stored response, marked with \`${IDEMPOTENT_REPLAY_HEADER}: true\`. ` +
    "The same key with a different body is refused 409 `idempotency_error`, as is a retry sent while the original is still running. " +
    "Only successful responses are stored, so a create that failed can simply be retried with the same key.",
  schema: {
    type: "string",
    minLength: MIN_KEY_LENGTH,
    maxLength: MAX_KEY_LENGTH,
  },
} as const;

/** The marker a replayed response carries, for a success response's `headers`. */
export const idempotentReplayHeaders = {
  [IDEMPOTENT_REPLAY_HEADER]: {
    description:
      "Present and `true` only when this body came from a stored response rather than a fresh execution. Absent on the first use of a key, and on every request that carries no key.",
    schema: { type: "string" as const, enum: ["true"] },
  },
};

/**
 * Write the outcome, flagging the ones that were replayed.
 *
 * That header is the only thing telling a replay apart from the original: the
 * status and the body are identical by design, so without it a caller cannot
 * know whether its retry created the resource or found it already made. It is
 * absent rather than `false` on a first execution, so its presence alone is
 * the signal.
 */
export function idempotentJson<T>(
  c: Context,
  outcome: IdempotentOutcome<T>,
): Response {
  if (!outcome.replayed) {
    return c.json(
      outcome.body as Record<string, unknown>,
      outcome.status as ContentfulStatusCode,
    );
  }

  c.header(IDEMPOTENT_REPLAY_HEADER, "true");
  // The stored bytes are written through rather than parsed and re-serialised,
  // so a replay cannot drift from the response it is standing in for. The
  // content type is set by hand for the same reason `c.json` is not used.
  c.header("Content-Type", "application/json");
  return c.body(outcome.serializedBody, outcome.status as ContentfulStatusCode);
}
