/**
 * The wire half of `Idempotency-Key`: the header names, the key bounds, how a
 * key is read off a request, and how an outcome is written back.
 *
 * The ledger itself — the receipt table, the claim heartbeat, the encrypted
 * stored body — stays in the process that owns a database and an encryption
 * key, and reaches a packaged REST family as an injected port. What lives here
 * is everything a family needs to DECLARE the behaviour: the OpenAPI parameter
 * and response header a create documents, which the spec generator has to be
 * able to build with no process at all, and the response writer that marks a
 * replay.
 *
 * One definition, because the two halves have to agree: the sentence the
 * document publishes quotes the same bounds the reader enforces, so a caller
 * cannot be told 8-255 and refused at 8.
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { RequestValidationError } from "./app-rest.validation";

/** The header a caller sends to make a create replayable. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/** Set on a response that was served from a receipt rather than re-executed. */
export const IDEMPOTENT_REPLAY_HEADER = "X-Idempotent-Replay";

/**
 * The key length bounds. The floor is there because a short key is not
 * plausibly unique, and a caller who reuses one across genuinely different
 * requests gets 409s instead of the creates they wanted. The ceiling is the
 * usual header-value hygiene.
 */
export const MIN_KEY_LENGTH = 8;
export const MAX_KEY_LENGTH = 255;

/**
 * Reads the key a caller sent, or null when they sent none.
 *
 * A missing header is not an error: the routes behave exactly as they did
 * before this module existed, and write no receipt at all. A header that IS
 * present but unusable is refused rather than ignored, including when it trims
 * to nothing, because a caller who sent one believes their retry is protected
 * and would otherwise find out from a duplicate row.
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

/** What a handler hands back: the status and body it wants answered with. */
export interface IdempotentHandlerResult<T> {
  status: number;
  body: T;
}

/** The handler ran: its own result, still to be serialised by the route. */
export interface IdempotentExecuted<T> extends IdempotentHandlerResult<T> {
  isReplayed: false;
}

/**
 * The handler did not run: the exact bytes the first execution answered with.
 *
 * Carried as a string rather than a parsed object so the replay cannot differ
 * from the original by so much as a key order.
 */
export interface IdempotentReplayed {
  isReplayed: true;
  status: number;
  serializedBody: string;
}

export type IdempotentOutcome<T> = IdempotentExecuted<T> | IdempotentReplayed;

/**
 * The ledger a packaged create dispatches through.
 *
 * `withIdempotency` in the application supplies this, already bound to the
 * process's receipt store; a family takes it as a port so the family itself
 * needs neither a database nor an encryption key.
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
  handler: () => Promise<IdempotentHandlerResult<unknown>>;
}) => Promise<IdempotentOutcome<unknown>>;

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
    // The values stay a mutable `string[]`: the OpenAPI header object this
    // is handed to types `enum` as a mutable array, and a readonly tuple
    // cannot be assigned to one.
    schema: { type: "string", enum: ["true"] as string[] },
  },
} as const;

/**
 * Write the outcome, flagging the ones that were replayed.
 *
 * That header is the only thing telling a replay apart from the original: the
 * status and the body are identical by design, so without it a caller cannot
 * know whether its retry created the resource or found it already made. It is
 * absent rather than `false` on a first execution, so its presence alone is
 * the signal.
 */
export function idempotentJson<T>({
  c,
  outcome,
}: {
  c: Context;
  outcome: IdempotentOutcome<T>;
}): Response {
  if (!outcome.isReplayed) {
    return c.json(outcome.body as Record<string, unknown>, outcome.status as ContentfulStatusCode);
  }

  c.header(IDEMPOTENT_REPLAY_HEADER, "true");
  // The stored bytes are written through rather than parsed and re-serialised,
  // so a replay cannot drift from the response it is standing in for. The
  // content type is set by hand for the same reason `c.json` is not used.
  c.header("Content-Type", "application/json");
  return c.body(outcome.serializedBody, outcome.status as ContentfulStatusCode);
}
