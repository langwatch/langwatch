/**
 * The wire half of `Idempotency-Key`. The ledger itself stays in the owning
 * process and reaches a family as an injected port; this is what a family
 * needs to DECLARE the behaviour without one.
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { RequestValidationError } from "./validation.js";

/** The header a caller sends to make a create replayable. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/** Set on a response that was served from a receipt rather than re-executed. */
export const IDEMPOTENT_REPLAY_HEADER = "X-Idempotent-Replay";

/** The key length bounds: floor guards against implausibly short reused keys. */
export const MIN_KEY_LENGTH = 8;
export const MAX_KEY_LENGTH = 255;

/**
 * A missing header writes no receipt. A present-but-unusable one is refused,
 * not ignored — a caller who sent one believes their retry is protected.
 */
export function readIdempotencyKey(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;

  const key = raw.trim();
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
    throw new RequestValidationError({
      target: "header",
      violations: [
        {
          field: IDEMPOTENCY_KEY_HEADER,
          type: "invalid_length",
          message: `${IDEMPOTENCY_KEY_HEADER} must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters.`,
          expected: `${MIN_KEY_LENGTH} to ${MAX_KEY_LENGTH} characters`,
          received: key.length,
        },
      ],
    });
  }

  return key;
}

/**
 * The whole `Response` travels back so the route answers with the exact
 * bytes the ledger stored, not a re-serialization.
 */
export interface IdempotentExecuted {
  isReplayed: false;
  status: number;
  response: Response;
}

/**
 * A string, not a parsed object, so a replay can't differ from the original
 * by so much as a key order.
 */
export interface IdempotentReplayed {
  isReplayed: true;
  status: number;
  serializedBody: string;
}

export type IdempotentOutcome = IdempotentExecuted | IdempotentReplayed;

/**
 * A family takes this as a port so it needs neither a database nor an
 * encryption key itself.
 */
export type IdempotentRunner = (input: {
  /**
   * Which create this is, e.g. `webhooks.v1.endpoints.create`. Folded into the
   * fingerprint so one key cannot answer for two different creates that share
   * a tenancy.
   */
  operation: string;
  /** The tenancy the key is unique within: a project id or an organization id. */
  scopeId: string;
  /** The key from {@link readIdempotencyKey}, or null for the unkeyed path. */
  key: string | null;
  /** The body as the route's validator produced it, not the raw bytes. */
  validatedBody: unknown;
  /**
   * Runs the create and writes its response. The ledger stores that response's
   * bytes as they are, which is what a replay hands back.
   */
  handler: () => Promise<Response>;
}) => Promise<IdempotentOutcome>;

/**
 * Spelled once so the docs can't drift from the same bounds the validator
 * enforces.
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
    // The values stay a mutable `string[]`: the OpenAPI header object this
    // is handed to types `enum` as a mutable array, and a readonly tuple
    // cannot be assigned to one.
    schema: { type: "string", enum: ["true"] as string[] },
  },
} as const;

/**
 * The replay header is the only thing telling a replay apart from the
 * original (status/body are identical by design). Absent, not `false`, on
 * a first execution — presence alone is the signal.
 */
export function idempotentJson({
  c,
  outcome,
}: {
  c: Context;
  outcome: IdempotentOutcome;
}): Response {
  // A first execution answers with the response it already wrote: those are
  // the bytes the receipt holds, so the replay below stands in for exactly
  // what the caller saw.
  if (!outcome.isReplayed) return outcome.response;

  c.header(IDEMPOTENT_REPLAY_HEADER, "true");
  // The stored bytes are written through rather than parsed and re-serialised,
  // so a replay cannot drift from the response it is standing in for. The
  // content type is set by hand for the same reason `c.json` is not used.
  c.header("Content-Type", "application/json");
  if (outcome.serializedBody === "") return c.body(null, outcome.status as ContentfulStatusCode);
  return c.body(outcome.serializedBody, outcome.status as ContentfulStatusCode);
}
