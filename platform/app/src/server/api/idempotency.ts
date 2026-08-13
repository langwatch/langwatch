/**
 * `Idempotency-Key` for the REST creates.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * A create is the one shape of request where a retry is dangerous. When a
 * caller's connection drops after the write but before the response, it cannot
 * tell a lost request from a lost reply, and the only safe-looking move,
 * retrying, mints a second virtual key, budget, cache rule or webhook
 * endpoint. Sending a key with the first attempt is how the caller says "these
 * two requests are the same request", and this module is what makes the second
 * one return the first one's answer.
 *
 * ── NOT MIDDLEWARE ─────────────────────────────────────────────────────────
 *
 * Deliberately a function the handler calls rather than middleware wrapping
 * it. Middleware would run before the route's validator and would therefore
 * have to consume and re-expose the raw body to fingerprint it. Called from
 * inside the handler, the fingerprint is taken over the already-validated
 * body: a request that never passed validation never reaches here, so no key
 * is ever burned on a request the platform refused outright.
 *
 * ── ONLY SUCCESSES ARE STORED ──────────────────────────────────────────────
 *
 * A pending row is inserted before the handler runs and is filled in only if
 * the handler returns 2xx. If the handler throws, the pending row is deleted
 * and the error propagates untouched.
 *
 * That is narrower than Stripe, which stores 4xx replies too, and the reason
 * is that Stripe cannot re-run your handler and we can. The hazard idempotency
 * exists to prevent is double creation, which only ever happens on success: a
 * create that failed left nothing behind, so re-running it is safe, and a
 * deterministic 4xx simply recurs on the retry with the same answer. Storing
 * failures would instead pin a transient error, a rate limit or a moment of
 * database unavailability to the key for 24 hours, so the caller's retry gets
 * the stale failure back rather than the success it would now get.
 *
 * ── A CLAIM IS HELD BY A LIVE REQUEST ──────────────────────────────────────
 *
 * The unique index on (scopeId, key) is what serialises two concurrent
 * retries: the second insert loses, finds a pending row, and is told to retry
 * shortly rather than being allowed to create alongside the first.
 *
 * That leaves the question of when a pending row may be superseded, because a
 * process that died between the insert and the update would otherwise hold the
 * key locked for its full 24 hour lifetime and the caller could never complete
 * the create it was trying to make. A row is superseded only once its claim
 * stops reporting itself alive: the request holding a claim rewrites
 * `heartbeatAt` every {@link HEARTBEAT_INTERVAL_MS} for as long as its handler
 * runs, and another request may take the claim over once that column has been
 * quiet for {@link TAKEOVER_AFTER_MS}.
 *
 * Liveness rather than age, because age says nothing about whether the
 * original is still running. A request merely slow past whatever horizon was
 * chosen, waiting on a row lock or a saturated connection pool, is still going
 * to write its resource, so superseding it mints the second resource the key
 * was sent to prevent, and does it exactly when the system is least able to
 * absorb it. A slow request keeps beating and keeps its claim; a dead one
 * stops beating and its key frees up in seconds rather than in minutes.
 *
 * ── FENCING ────────────────────────────────────────────────────────────────
 *
 * A takeover rewrites the row's `claimId` rather than deleting the row, so the
 * request that took over owns the claim and the one it replaced stays
 * recognisable. Every write the replaced request goes on to make names the
 * claim it still thinks it holds, so a process that resumes after being
 * declared dead cannot overwrite the receipt of the request that replaced it.
 * The attempt is logged, and that log is the signal that one key may have
 * produced two resources.
 *
 * ── THE STORED BODY IS ENCRYPTED ───────────────────────────────────────────
 *
 * Two of the four creates answer with a secret that is kept nowhere else in
 * readable form: the virtual key's secret and the webhook endpoint's signing
 * secret are both shown once and stored only as a hash. Replaying those
 * responses is the whole point of a key on those routes, and it means the
 * secret transits the receipt. So the body is held as AES-256-GCM ciphertext
 * under `CREDENTIALS_SECRET`, the same treatment the automations webhook gives
 * its custom headers, and expiry bounds how long it exists at all.
 *
 * The body is stored as the exact bytes the first response carried, which is
 * also what makes a replay byte-identical: it is a string round trip, so
 * nothing in storage is in a position to reorder or renormalise it.
 */
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  type IdempotencyReceipt,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { nanoid } from "nanoid";

import {
  sha256,
  stableStringify,
} from "~/server/event-sourcing/pipelines/metric-processing/canonical/serialization";
import { decrypt, encrypt } from "~/utils/encryption";

import { RequestValidationError } from "./validation";

const logger = createLogger("langwatch:api:idempotency");

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

/** How long a receipt answers for. */
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

/** How often a request reports that the claim it holds is still running. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * How long a claim may go quiet before another request may take it over.
 *
 * Four missed beats rather than one, so an interval a garbage collection pause
 * or a momentarily busy database swallowed is not read as a death. It stays a
 * small multiple of the interval all the same: the whole point of measuring
 * liveness is that a claim nobody is holding is released in seconds.
 */
export const TAKEOVER_AFTER_MS = 4 * HEARTBEAT_INTERVAL_MS;

/**
 * How many times the claim will re-attempt after losing its insert.
 *
 * Each loss is followed by a read that either answers the request or clears
 * the row and tries again, so the loop only spins when rows are being cleared
 * underneath it. Bounded so a pathological race cannot spin forever.
 */
const CLAIM_ATTEMPTS = 3;

/** Why a key was refused. Echoed as `meta.reason` so a caller can branch. */
export type IdempotencyConflictReason = "body_mismatch" | "in_progress";

const CONFLICT_MESSAGES = {
  body_mismatch:
    "This Idempotency-Key was already used with a different request body.",
  in_progress:
    "The original request with this Idempotency-Key is still in progress; retry shortly.",
} as const satisfies Record<IdempotencyConflictReason, string>;

/**
 * The key cannot answer this request.
 *
 * A 409 rather than a 400 in both cases: the request is well-formed and would
 * have been accepted under another key, so the caller's fix is to pick a new
 * key or to wait, not to correct a malformed field.
 */
export class IdempotencyConflictError extends HandledError {
  declare readonly code: "idempotency_error";

  constructor(reason: IdempotencyConflictReason) {
    super("idempotency_error", CONFLICT_MESSAGES[reason], {
      meta: { reason },
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "IdempotencyConflictError";
  }
}

/**
 * The key this request carries, or null when it carries none.
 *
 * A missing header is not an error: the routes behave exactly as they did
 * before this module existed, and write no receipt at all. A header that IS
 * present but unusable is refused rather than ignored, including when it trims
 * to nothing, because a caller who sent one believes their retry is protected
 * and would otherwise find out from a duplicate row.
 */
export function readIdempotencyKey(
  raw: string | undefined | null,
): string | null {
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
 * The fingerprint two requests must share to count as the same request.
 *
 * Key order independent, so a caller whose serialiser emits fields in a
 * different order on the retry is not told its body changed.
 *
 * The operation is part of it because the receipt is keyed by tenancy alone:
 * the gateway platform's creates all authenticate at the project, so one key
 * reused across two different creates lands on the same row. Without the
 * operation, two creates that happen to validate to the same body would
 * replay each other's response; with it, they are told the key is taken.
 */
export function fingerprintRequestBody({
  operation,
  body,
}: {
  operation: string;
  body: unknown;
}): string {
  return sha256(stableStringify({ operation, body }));
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
 * from the original by so much as a key order. See {@link withIdempotency}.
 */
export interface IdempotentReplayed {
  isReplayed: true;
  status: number;
  serializedBody: string;
}

export type IdempotentOutcome<T> = IdempotentExecuted<T> | IdempotentReplayed;

export interface WithIdempotencyParams<T> {
  prisma: PrismaClient;
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
  handler: () => Promise<IdempotentHandlerResult<T>>;
}

/**
 * Runs `handler` at most once per (scopeId, key), replaying its answer after.
 *
 * With no key it is a pass-through and touches no storage at all.
 */
export async function withIdempotency<T>({
  prisma,
  operation,
  scopeId,
  key,
  validatedBody,
  handler,
}: WithIdempotencyParams<T>): Promise<IdempotentOutcome<T>> {
  if (key === null) {
    return { ...(await handler()), isReplayed: false };
  }

  const requestFingerprint = fingerprintRequestBody({
    operation,
    body: validatedBody,
  });
  const claim = await claimReceipt({
    prisma,
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
  const heartbeat = startClaimHeartbeat({ prisma, receiptId, claimId });

  try {
    let result: IdempotentHandlerResult<T>;
    try {
      result = await handler();
    } catch (error) {
      await releaseClaim({ prisma, receiptId, claimId });
      throw error;
    }

    if (result.status >= 200 && result.status < 300) {
      await finalizeClaim({
        prisma,
        receiptId,
        claimId,
        status: result.status,
        // The bytes the route is about to write, not the object behind them,
        // so a replay reproduces this response rather than re-deriving it.
        serializedBody: serializeResponseBody(result.body),
      });
    } else {
      await releaseClaim({ prisma, receiptId, claimId });
    }

    return { ...result, isReplayed: false };
  } finally {
    heartbeat.stop();
  }
}

/** A running claim's liveness reporting, for as long as its handler runs. */
interface ClaimHeartbeat {
  stop: () => void;
}

/**
 * Report the claim as still running, until told to stop.
 *
 * On its own timer rather than driven by the handler, because the handler is
 * an opaque call that can spend minutes inside one database round trip without
 * emitting anything, and those are precisely the requests a takeover must not
 * declare dead. Unreferenced so it can never be the reason the process stays
 * up, and a beat that fails is logged rather than propagated: the create is
 * what the caller asked for, and losing a beat costs at worst a takeover that
 * fencing then catches.
 */
function startClaimHeartbeat({
  prisma,
  receiptId,
  claimId,
}: {
  prisma: PrismaClient;
  receiptId: string;
  claimId: string;
}): ClaimHeartbeat {
  const timer = setInterval(() => {
    prisma.idempotencyReceipt
      .updateMany({
        where: { id: receiptId, claimId },
        data: { heartbeatAt: new Date() },
      })
      .then(({ count }) => {
        if (count > 0) return;
        // The claim is somebody else's now. Warn once and stop, rather than
        // writing nothing every interval for the rest of the handler.
        logger.warn(
          { receiptId, claimId },
          "Stopped reporting an idempotency claim this request no longer holds",
        );
        clearInterval(timer);
      })
      .catch((error) => {
        logger.warn(
          { receiptId, claimId, error },
          "Failed to report an idempotency claim as still running",
        );
      });
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();

  return { stop: () => clearInterval(timer) };
}

/**
 * Store the response this claim produced, if the claim is still ours.
 *
 * The `claimId` predicate is the fence. Affecting no rows means this request
 * was declared dead and replaced while its handler was still running, so the
 * resource it just created is one the replacing request is about to create a
 * second copy of. Nothing here can undo that, and overwriting the new claim's
 * row would only hide it, so it is logged as the loud signal instead.
 */
async function finalizeClaim({
  prisma,
  receiptId,
  claimId,
  status,
  serializedBody,
}: {
  prisma: PrismaClient;
  receiptId: string;
  claimId: string;
  status: number;
  serializedBody: string;
}): Promise<void> {
  const { count } = await prisma.idempotencyReceipt.updateMany({
    where: { id: receiptId, claimId },
    data: { responseStatus: status, responseBody: encrypt(serializedBody) },
  });

  if (count === 0) {
    logger.error(
      { receiptId, claimId, status },
      "An idempotency claim was taken over while its request was still running: the response was not stored and the key may now stand for a second resource",
    );
  }
}

/**
 * The exact bytes a route answers a body with.
 *
 * Must stay in step with how the route writes a fresh response, because the
 * stored copy is what a replay serves in place of re-running the handler.
 * Both are `JSON.stringify`, which is what Hono's `c.json` does.
 */
export function serializeResponseBody(body: unknown): string {
  return JSON.stringify(body);
}

type Claim =
  | { kind: "claimed"; receiptId: string; claimId: string }
  | { kind: "replay"; status: number; serializedBody: string };

/**
 * What a row already under the key resolves to.
 *
 * `claimed` is reachable here as well as from a winning insert, because a row
 * whose claim stopped reporting itself alive is taken over in place rather
 * than deleted: the taking request ends up holding the same row under a new
 * claim id. `retry` means the row was not authoritative, so the key is worth
 * attempting again.
 */
type ExistingVerdict = Claim | { kind: "retry" };

/**
 * Take the key, or read what the row already there says to do.
 *
 * The insert goes first on purpose. A read-then-write would let two concurrent
 * retries both find the key free, and the second create is exactly what the
 * key was sent to prevent. The unique index is the only thing that actually
 * decides, so it is what the outcome is read from.
 */
async function claimReceipt({
  prisma,
  scopeId,
  key,
  requestFingerprint,
}: {
  prisma: PrismaClient;
  scopeId: string;
  key: string;
  requestFingerprint: string;
}): Promise<Claim> {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const now = new Date();

    const claimed = await insertPendingReceipt({
      prisma,
      scopeId,
      key,
      requestFingerprint,
      now,
    });
    if (claimed !== null) return claimed;

    const existing = await prisma.idempotencyReceipt.findUnique({
      where: { scopeId_key: { scopeId, key } },
    });

    // Raced against a delete: the row went away between the insert losing and
    // this read, so the key is free again.
    if (!existing) continue;

    const verdict = await readExistingReceipt({
      prisma,
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
  prisma,
  scopeId,
  key,
  requestFingerprint,
  now,
}: {
  prisma: PrismaClient;
  scopeId: string;
  key: string;
  requestFingerprint: string;
  now: Date;
}): Promise<Extract<Claim, { kind: "claimed" }> | null> {
  const claimId = nanoid();

  try {
    const created = await prisma.idempotencyReceipt.create({
      data: {
        scopeId,
        key,
        claimId,
        requestFingerprint,
        // The first beat is the insert itself, so the row is never momentarily
        // takeable in the interval before the timer's first tick.
        heartbeatAt: now,
        expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS),
      },
      select: { id: true },
    });
    return { kind: "claimed", receiptId: created.id, claimId };
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/**
 * Whether a pending claim has gone quiet long enough to be taken over.
 *
 * The whole takeover decision, in one place and with no storage behind it, so
 * what it turns on is a matter of record: the last time the holder said it was
 * running, never how long ago the claim was made.
 */
export function isClaimAbandoned({
  heartbeatAt,
  now,
}: {
  heartbeatAt: Date;
  now: Date;
}): boolean {
  return now.getTime() - heartbeatAt.getTime() > TAKEOVER_AFTER_MS;
}

/**
 * Take a silent claim over, or report that someone else got there first.
 *
 * An update rather than a delete and a fresh insert, so the row keeps its
 * identity and the claim that was displaced can be told apart from the one
 * that displaced it. The `claimId` in the predicate is what makes two requests
 * racing to take the same silent claim over resolve to one winner, and the
 * loser is sent back to re-read a row that is now beating again.
 */
async function takeOverClaim({
  prisma,
  existing,
  now,
}: {
  prisma: PrismaClient;
  existing: IdempotencyReceipt;
  now: Date;
}): Promise<ExistingVerdict> {
  const claimId = nanoid();
  const { count } = await prisma.idempotencyReceipt.updateMany({
    where: { id: existing.id, claimId: existing.claimId, responseStatus: null },
    data: {
      claimId,
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS),
    },
  });

  if (count === 0) return { kind: "retry" };

  logger.warn(
    {
      receiptId: existing.id,
      displacedClaimId: existing.claimId,
      claimId,
      quietForMs: now.getTime() - existing.heartbeatAt.getTime(),
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
  prisma,
  existing,
  requestFingerprint,
  now,
}: {
  prisma: PrismaClient;
  existing: IdempotencyReceipt;
  requestFingerprint: string;
  now: Date;
}): Promise<ExistingVerdict> {
  // Expiry is read before anything else, so a key past its lifetime is a
  // fresh key regardless of what the stale row happens to say.
  if (existing.expiresAt.getTime() <= now.getTime()) {
    await discardReceipt({ prisma, receiptId: existing.id });
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
    if (!isClaimAbandoned({ heartbeatAt: existing.heartbeatAt, now })) {
      throw new IdempotencyConflictError("in_progress");
    }
    return await takeOverClaim({ prisma, existing, now });
  }

  const serializedBody = readStoredBody(existing);
  // Nothing readable to replay, so the receipt cannot answer for the key. Same
  // handling as expiry: drop it and let the request through as a first use,
  // which is strictly better than refusing a create the caller can never make.
  if (serializedBody === null) {
    await discardReceipt({ prisma, receiptId: existing.id });
    return { kind: "retry" };
  }

  return {
    kind: "replay",
    status: existing.responseStatus,
    serializedBody,
  };
}

/**
 * The stored response bytes, or null when this row cannot be read back.
 *
 * The realistic cause is `CREDENTIALS_SECRET` having been rotated inside the
 * receipt's 24 hours, which leaves rows that are authentic but no longer
 * decryptable. Dropping them matches how the model provider repository treats
 * customKeys it can no longer read: an unreadable secret is treated as absent
 * rather than as a failure the caller has to understand.
 */
export function readStoredBody(receipt: IdempotencyReceipt): string | null {
  if (receipt.responseBody === null) return null;

  try {
    return decrypt(receipt.responseBody);
  } catch (error) {
    logger.warn(
      { receiptId: receipt.id, error },
      "Dropping an unreadable idempotency receipt, likely CREDENTIALS_SECRET rotated since it was written",
    );
    return null;
  }
}

/**
 * Give up the claim this request holds, so the key is usable again.
 *
 * Fenced on `claimId` like every other write a claim holder makes: a request
 * that was declared dead and replaced must not delete the row the replacing
 * request is now working under. Affecting no rows is far less serious here
 * than on the finalize path, since a claim released is a create that failed
 * and left nothing behind, but it is still worth saying that this request no
 * longer had the key it thought it had.
 *
 * `deleteMany` rather than `delete` so a row already cleared by a concurrent
 * attempt is not a second error on top of whatever is being handled.
 */
async function releaseClaim({
  prisma,
  receiptId,
  claimId,
}: {
  prisma: PrismaClient;
  receiptId: string;
  claimId: string;
}): Promise<void> {
  try {
    const { count } = await prisma.idempotencyReceipt.deleteMany({
      where: { id: receiptId, claimId },
    });
    if (count === 0) {
      logger.warn(
        { receiptId, claimId },
        "An idempotency claim was taken over before its request could release it",
      );
    }
  } catch (error) {
    // Called on the failure path, where the caller is already propagating
    // something more informative. A receipt left pending expires on its own.
    logger.warn(
      { receiptId, error },
      "Failed to release a pending idempotency receipt",
    );
  }
}

/**
 * Drop a receipt nobody holds a claim on, by id.
 *
 * Unconditional, unlike {@link releaseClaim}, because the rows this collects
 * are ones no request is working under: a receipt past its expiry, and one
 * whose stored body can no longer be decrypted. Both are read on the way past
 * by whichever request presents the key next.
 */
async function discardReceipt({
  prisma,
  receiptId,
}: {
  prisma: PrismaClient;
  receiptId: string;
}): Promise<void> {
  try {
    await prisma.idempotencyReceipt.deleteMany({ where: { id: receiptId } });
  } catch (error) {
    logger.warn(
      { receiptId, error },
      "Failed to discard a spent idempotency receipt",
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
