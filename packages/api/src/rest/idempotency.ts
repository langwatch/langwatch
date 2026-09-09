/**
 * `Idempotency-Key`: the wire half a family declares the behaviour with, and
 * the receipt ledger the owning process fills it in with. Called from inside
 * the handler rather than as middleware, so the fingerprint runs over the
 * already-validated body.
 */
import { randomUUID } from "node:crypto";

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { type Instant, fromDate, nowInstant, toDate } from "@langwatch/time";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { fingerprintJson, RequestValidationError, sha256 } from "./request.ts";

const idempotencyLogger = createLogger("langwatch:api:idempotency");

// ─────────────────────────────────────────────────────────────────────────────
// `Idempotency-Key`, the wire half. The ledger itself stays in the owning
// process and reaches a family as an injected port; this is what a family needs
// to DECLARE the behaviour without one.
// ─────────────────────────────────────────────────────────────────────────────

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
 * What a replayable create declares: which create it is, and nothing else. The
 * tenancy a key is unique within is the scope access already resolved, so a
 * route cannot name a narrower one than the door it answers behind.
 */
export type RestIdempotency = Readonly<{ operation: string }>;

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
  // so a replay cannot drift from the response it is standing in for.
  c.header("Content-Type", "application/json");
  if (outcome.serializedBody === "") return c.body(null, outcome.status as ContentfulStatusCode);
  return c.body(outcome.serializedBody, outcome.status as ContentfulStatusCode);
}

// ─────────────────────────────────────────────────────────────────────────────
// The receipt ledger behind `Idempotency-Key`. Called from inside the handler,
// not as middleware, so the fingerprint runs over the already-validated body. A
// pending row is filled in only on 2xx; a throw deletes it, since a failed
// create left nothing behind to double-create.
// ─────────────────────────────────────────────────────────────────────────────

/** How long a receipt answers for. */
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

/** How often a request reports that the claim it holds is still running. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Superseded by LIVENESS, not age: a slow request keeps beating and keeps
 * its claim. A takeover rewrites `claimId` rather than deleting the row, so
 * the replaced request's writes are fenced by a claim id it no longer holds.
 * Four missed beats, not one, so a GC pause isn't read as a death.
 */
export const TAKEOVER_AFTER_MS = 4 * HEARTBEAT_INTERVAL_MS;

/**
 * Bounded so a pathological race of insert-loss-then-clear cannot spin
 * forever.
 */
const CLAIM_ATTEMPTS = 3;

/** Why a key was refused. Echoed as `meta.reason` so a caller can branch. */
export type IdempotencyConflictReason = "body_mismatch" | "in_progress";

const CONFLICT_MESSAGES = {
  body_mismatch: "This Idempotency-Key was already used with a different request body.",
  in_progress:
    "The original request with this Idempotency-Key is still in progress; retry shortly.",
} as const satisfies Record<IdempotencyConflictReason, string>;

/**
 * A 409, not 400: the request is well-formed, so the caller's fix is a new
 * key or a wait, not a corrected field.
 */
export class IdempotencyConflictError extends HandledError {
  declare readonly code: "idempotency_error";

  constructor(reason: IdempotencyConflictReason) {
    super("idempotency_error", CONFLICT_MESSAGES[reason], {
      meta: { reason },
      httpStatus: 409,
      fault: "customer",
      retryable: reason === "in_progress",
    });
    this.name = "IdempotencyConflictError";
  }
}

/**
 * Key order independent. `operation` is included since the receipt is keyed
 * by tenancy alone — without it, two different creates with the same body
 * would replay each other's response.
 */
export function fingerprintRequestBody({
  operation,
  body,
}: {
  operation: string;
  body: unknown;
}): string {
  return sha256(fingerprintJson({ operation, body }));
}

export type IdempotencyReceiptCreateInput = {
  scopeId: string;
  key: string;
  claimId: string;
  requestFingerprint: string;
  heartbeatAt: Date;
  expiresAt: Date;
};

/**
 * Stated structurally, not imported from generated Prisma types — this
 * package is the API framework and may not depend on a schema.
 */
export type IdempotencyReceiptRecord = {
  id: string;
  claimId: string;
  requestFingerprint: string;
  heartbeatAt: Date;
  expiresAt: Date;
  responseStatus: number | null;
  responseBody: string | null;
};

export type IdempotencyReceiptUpdateInput = Partial<
  Pick<
    IdempotencyReceiptRecord,
    "claimId" | "heartbeatAt" | "expiresAt" | "responseStatus" | "responseBody"
  >
>;

/** Minimal durable receipt store used by the idempotency protocol. */
export interface IdempotencyReceiptPersistence {
  readonly idempotencyReceipt: {
    create(input: {
      data: IdempotencyReceiptCreateInput;
      select: { id: true };
    }): Promise<{ id: string }>;
    findUnique(input: {
      where: { scopeId_key: { scopeId: string; key: string } };
    }): Promise<IdempotencyReceiptRecord | null>;
    updateMany(input: {
      where: { id: string; claimId?: string; responseStatus?: null };
      data: IdempotencyReceiptUpdateInput;
    }): Promise<{ count: number }>;
    deleteMany(input: { where: { id: string; claimId?: string } }): Promise<{ count: number }>;
  };
}

/**
 * A port, since the key (`CREDENTIALS_SECRET`) belongs to the process and
 * this package reads no environment.
 */
export interface IdempotencyResponseCipher {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export interface WithIdempotencyParams {
  receipts: IdempotencyReceiptPersistence;
  /** The cipher the stored response body is written and read under. */
  cipher: IdempotencyResponseCipher;
  /**
   * Which create this is, e.g. `gateway.v1.virtual-keys.create`. Folded into
   * the fingerprint so one key cannot answer for two different creates that
   * share a tenancy.
   */
  operation: string;
  /** The tenancy the key is unique within: a project id or an organization id. */
  scopeId: string;
  /** The key from {@link readIdempotencyKey}, or null for the unkeyed path. */
  key: string | null;
  /** The body as the route's validator produced it, not the raw bytes. */
  validatedBody: unknown;
  /**
   * Runs the create and writes its response. What the receipt stores is that
   * response's own bytes, so a replay cannot re-derive them differently.
   */
  handler: () => Promise<Response>;
}

/**
 * Runs `handler` at most once per (scopeId, key), replaying its answer after.
 *
 * With no key it is a pass-through and touches no storage at all.
 */
export async function withIdempotency({
  receipts,
  cipher,
  operation,
  scopeId,
  key,
  validatedBody,
  handler,
}: WithIdempotencyParams): Promise<IdempotentOutcome> {
  if (key === null) {
    const response = await handler();
    return { isReplayed: false, status: response.status, response };
  }

  const requestFingerprint = fingerprintRequestBody({
    operation,
    body: validatedBody,
  });
  const claim = await claimReceipt({
    receipts,
    cipher,
    scopeId,
    key,
    requestFingerprint,
  });

  if (claim.kind === "replay") {
    return {
      isReplayed: true,
      status: claim.status,
      serializedBody: claim.serializedBody,
    };
  }

  const { receiptId, claimId } = claim;
  // Started before the handler and stopped in a finally, so the claim is
  // reported alive for exactly as long as this request is working on it.
  const heartbeat = startClaimHeartbeat({ receipts, receiptId, claimId });

  try {
    let response: Response;
    try {
      response = await handler();
    } catch (error) {
      await releaseClaim({ receipts, receiptId, claimId });
      throw error;
    }

    if (response.status >= 200 && response.status < 300) {
      await finalizeClaim({
        receipts,
        cipher,
        receiptId,
        claimId,
        status: response.status,
        // The bytes the caller is about to receive, read off the response
        // itself rather than re-serialised from the value behind it: an output
        // schema can order keys differently from the handler's object, and a
        // replay that re-derived the body would answer the same values in
        // different bytes.
        serializedBody: await readResponseBytes(response),
      });
    } else {
      await releaseClaim({ receipts, receiptId, claimId });
    }

    return { isReplayed: false, status: response.status, response };
  } finally {
    heartbeat.stop();
  }
}

/**
 * The response's body as bytes, without consuming the response the route is
 * about to return: the clone is what is read, the original is answered with.
 */
async function readResponseBytes(response: Response): Promise<string> {
  if (response.body === null) return "";
  return await response.clone().text();
}

/** A running claim's liveness reporting, for as long as its handler runs. */
interface ClaimHeartbeat {
  stop: () => void;
}

/**
 * On its own timer, not driven by the handler, since the handler can spend
 * minutes silent in one round trip. Unreferenced; a failed beat is logged,
 * not propagated — fencing catches the worst case.
 */
function startClaimHeartbeat({
  receipts,
  receiptId,
  claimId,
}: {
  receipts: IdempotencyReceiptPersistence;
  receiptId: string;
  claimId: string;
}): ClaimHeartbeat {
  const timer = setInterval(() => {
    receipts.idempotencyReceipt
      .updateMany({
        where: { id: receiptId, claimId },
        data: { heartbeatAt: toDate(nowInstant()) },
      })
      .then(({ count }) => {
        if (count > 0) return;
        // The claim is somebody else's now. Warn once and stop, rather than
        // writing nothing every interval for the rest of the handler.
        idempotencyLogger.warn(
          { receiptId, claimId },
          "Stopped reporting an idempotency claim this request no longer holds",
        );
        clearInterval(timer);
      })
      .catch((error) => {
        idempotencyLogger.warn(
          { receiptId, claimId, error },
          "Failed to report an idempotency claim as still running",
        );
      });
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();

  return { stop: () => clearInterval(timer) };
}

/**
 * The `claimId` predicate is the fence. Zero rows affected means this
 * request was declared dead and replaced mid-handler, so it logs loudly
 * rather than overwriting the new claim's row.
 */
async function finalizeClaim({
  receipts,
  cipher,
  receiptId,
  claimId,
  status,
  serializedBody,
}: {
  receipts: IdempotencyReceiptPersistence;
  cipher: IdempotencyResponseCipher;
  receiptId: string;
  claimId: string;
  status: number;
  serializedBody: string;
}): Promise<void> {
  const { count } = await receipts.idempotencyReceipt.updateMany({
    where: { id: receiptId, claimId },
    // Ciphertext; see `readStoredBody` for why.
    data: { responseStatus: status, responseBody: cipher.encrypt(serializedBody) },
  });

  if (count === 0) {
    idempotencyLogger.error(
      { receiptId, claimId, status },
      "An idempotency claim was taken over while its request was still running: the response was not stored and the key may now stand for a second resource",
    );
  }
}

/**
 * The bytes `c.json` writes for a body, for a caller that holds the value and
 * needs the receipt's stored form of it. The ledger itself no longer derives
 * the stored bytes this way: it reads them off the response the route wrote.
 */
export function serializeResponseBody(body: unknown): string {
  return JSON.stringify(body);
}

type Claim =
  | { kind: "claimed"; receiptId: string; claimId: string }
  | { kind: "replay"; status: number; serializedBody: string };

/**
 * `claimed` also comes from a takeover-in-place, not only a winning insert.
 * `retry` means the row wasn't authoritative.
 */
type ExistingVerdict = Claim | { kind: "retry" };

/**
 * Insert goes first: a read-then-write would let two concurrent retries
 * both find the key free.
 */
async function claimReceipt({
  receipts,
  cipher,
  scopeId,
  key,
  requestFingerprint,
}: {
  receipts: IdempotencyReceiptPersistence;
  cipher: IdempotencyResponseCipher;
  scopeId: string;
  key: string;
  requestFingerprint: string;
}): Promise<Claim> {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const now = nowInstant();

    const claimed = await insertPendingReceipt({
      receipts,
      scopeId,
      key,
      requestFingerprint,
      now,
    });
    if (claimed !== null) return claimed;

    const existing = await receipts.idempotencyReceipt.findUnique({
      where: { scopeId_key: { scopeId, key } },
    });

    // Raced against a delete: the row went away between the insert losing and
    // this read, so the key is free again.
    if (!existing) continue;

    const verdict = await readExistingReceipt({
      receipts,
      cipher,
      existing,
      requestFingerprint,
      now,
    });
    if (verdict.kind !== "retry") return verdict;
  }

  // Every attempt lost its insert and then found the row gone. Something is
  // clearing rows underneath us; answer as contention rather than spinning.
  throw new IdempotencyConflictError("in_progress");
}

/** The claim on a fresh pending row, or null when the key was already taken. */
async function insertPendingReceipt({
  receipts,
  scopeId,
  key,
  requestFingerprint,
  now,
}: {
  receipts: IdempotencyReceiptPersistence;
  scopeId: string;
  key: string;
  requestFingerprint: string;
  now: Instant;
}): Promise<Extract<Claim, { kind: "claimed" }> | null> {
  const claimId = randomUUID();

  try {
    const created = await receipts.idempotencyReceipt.create({
      data: {
        scopeId,
        key,
        claimId,
        requestFingerprint,
        // The first beat is the insert itself, so the row is never momentarily
        // takeable in the interval before the timer's first tick.
        heartbeatAt: toDate(now),
        expiresAt: toDate(now.add({ milliseconds: RECEIPT_TTL_MS })),
      },
      select: { id: true },
    });
    return { kind: "claimed", receiptId: created.id, claimId };
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/** Turns on the last heartbeat, never how long ago the claim was made. */
export function isClaimAbandoned({
  heartbeatAt,
  now,
}: {
  heartbeatAt: Instant;
  now: Instant;
}): boolean {
  return now.epochMilliseconds - heartbeatAt.epochMilliseconds > TAKEOVER_AFTER_MS;
}

/**
 * An update, not delete-and-insert, so the row keeps its identity. The
 * `claimId` predicate resolves two racing takeovers to one winner.
 */
async function takeOverClaim({
  receipts,
  existing,
  now,
}: {
  receipts: IdempotencyReceiptPersistence;
  existing: IdempotencyReceiptRecord;
  now: Instant;
}): Promise<ExistingVerdict> {
  const claimId = randomUUID();
  const { count } = await receipts.idempotencyReceipt.updateMany({
    where: { id: existing.id, claimId: existing.claimId, responseStatus: null },
    data: {
      claimId,
      heartbeatAt: toDate(now),
      expiresAt: toDate(now.add({ milliseconds: RECEIPT_TTL_MS })),
    },
  });

  if (count === 0) return { kind: "retry" };

  idempotencyLogger.warn(
    {
      receiptId: existing.id,
      displacedClaimId: existing.claimId,
      claimId,
      quietForMs: now.epochMilliseconds - existing.heartbeatAt.getTime(),
    },
    "Took over an idempotency claim that stopped reporting itself alive",
  );
  return { kind: "claimed", receiptId: existing.id, claimId };
}

/**
 * What the row already under this key says to do.
 *
 * `retry` means the row was not authoritative and has been cleared, so the
 * key is free for another attempt. Refusals throw.
 */
async function readExistingReceipt({
  receipts,
  cipher,
  existing,
  requestFingerprint,
  now,
}: {
  receipts: IdempotencyReceiptPersistence;
  cipher: IdempotencyResponseCipher;
  existing: IdempotencyReceiptRecord;
  requestFingerprint: string;
  now: Instant;
}): Promise<ExistingVerdict> {
  // Expiry is read before anything else, so a key past its lifetime is a
  // fresh key regardless of what the stale row happens to say.
  if (existing.expiresAt.getTime() <= now.epochMilliseconds) {
    await discardReceipt({ receipts, receiptId: existing.id });
    return { kind: "retry" };
  }

  // Ahead of the pending branch: a caller reusing one key for two different
  // bodies has made a mistake worth naming, whether or not the first request
  // has finished.
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new IdempotencyConflictError("body_mismatch");
  }

  if (existing.responseStatus === null) {
    // Still reporting itself alive, however long ago it started. However slow
    // it is being, it is going to write its resource, and taking the key off
    // it is what would make one key stand for two.
    if (!isClaimAbandoned({ heartbeatAt: fromDate(existing.heartbeatAt), now })) {
      throw new IdempotencyConflictError("in_progress");
    }
    return await takeOverClaim({ receipts, existing, now });
  }

  const serializedBody = readStoredBody({ receipt: existing, cipher });
  // Nothing readable to replay, so the receipt cannot answer for the key. Same
  // handling as expiry: drop it and let the request through as a first use,
  // which is strictly better than refusing a create the caller can never make.
  if (serializedBody === null) {
    await discardReceipt({ receipts, receiptId: existing.id });
    return { kind: "retry" };
  }

  return {
    kind: "replay",
    status: existing.responseStatus,
    serializedBody,
  };
}

/**
 * Two of the four creates replay a secret shown only once (virtual key,
 * webhook signing secret), so the body is held as ciphertext under
 * {@link IdempotencyResponseCipher}. An unreadable row (secret rotated
 * mid-TTL) is dropped and treated as absent, not a failure.
 */
export function readStoredBody({
  receipt,
  cipher,
}: {
  receipt: IdempotencyReceiptRecord;
  cipher: IdempotencyResponseCipher;
}): string | null {
  if (receipt.responseBody === null) return null;

  try {
    return cipher.decrypt(receipt.responseBody);
  } catch (error) {
    idempotencyLogger.warn(
      { receiptId: receipt.id, error },
      "Dropping an unreadable idempotency receipt, likely CREDENTIALS_SECRET rotated since it was written",
    );
    return null;
  }
}

/**
 * Fenced on `claimId` like every other write a claim holder makes, so a
 * dead-and-replaced request can't delete the replacing request's row.
 */
async function releaseClaim({
  receipts,
  receiptId,
  claimId,
}: {
  receipts: IdempotencyReceiptPersistence;
  receiptId: string;
  claimId: string;
}): Promise<void> {
  try {
    const { count } = await receipts.idempotencyReceipt.deleteMany({
      where: { id: receiptId, claimId },
    });
    if (count === 0) {
      idempotencyLogger.warn(
        { receiptId, claimId },
        "An idempotency claim was taken over before its request could release it",
      );
    }
  } catch (error) {
    // Called on the failure path, where the caller is already propagating
    // something more informative. A receipt left pending expires on its own.
    idempotencyLogger.warn({ receiptId, error }, "Failed to release a pending idempotency receipt");
  }
}

/**
 * Unconditional, unlike {@link releaseClaim}: these rows (expired, or
 * undecryptable) have no request working under them.
 */
async function discardReceipt({
  receipts,
  receiptId,
}: {
  receipts: IdempotencyReceiptPersistence;
  receiptId: string;
}): Promise<void> {
  try {
    await receipts.idempotencyReceipt.deleteMany({ where: { id: receiptId } });
  } catch (error) {
    idempotencyLogger.warn({ receiptId, error }, "Failed to discard a spent idempotency receipt");
  }
}

/**
 * Duck-typed on the driver's own code, not `instanceof`: a bundler can
 * produce two copies of the error class, and a class check would then miss
 * a real violation.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

/**
 * ONE ledger per process: two ledgers over the same table would run two
 * takeover clocks against each other's claims. Satisfies {@link IdempotentRunner}.
 */
export class IdempotencyLedger {
  static create(options: {
    receipts: IdempotencyReceiptPersistence;
    cipher: IdempotencyResponseCipher;
  }): IdempotencyLedger {
    return new IdempotencyLedger(options.receipts, options.cipher);
  }

  private constructor(
    private readonly receipts: IdempotencyReceiptPersistence,
    private readonly cipher: IdempotencyResponseCipher,
  ) {}

  /**
   * The runner a keyed create dispatches through.
   *
   * A bound property rather than a method, so a composition can hand
   * `ledger.run` straight to a family's port without losing `this`.
   */
  readonly run: IdempotentRunner = (input) =>
    withIdempotency({
      receipts: this.receipts,
      cipher: this.cipher,
      operation: input.operation,
      scopeId: input.scopeId,
      key: input.key,
      validatedBody: input.validatedBody,
      handler: input.handler,
    });
}
