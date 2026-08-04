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
 * ── THE PENDING WINDOW ─────────────────────────────────────────────────────
 *
 * The unique index on (scopeId, key) is what serialises two concurrent
 * retries: the second insert loses, finds a pending row, and is told to retry
 * shortly rather than being allowed to create alongside the first. A pending
 * row older than {@link PENDING_TAKEOVER_MS} is treated as a crashed original
 * and superseded. Without that, a process that died between the insert and the
 * update would hold the key locked for the full 24 hour lifetime, and the
 * caller could never complete the create it was trying to make.
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

/** How long a pending receipt is believed before it is read as a crash. */
export const PENDING_TAKEOVER_MS = 60_000;

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

const CONFLICT_MESSAGES: Record<IdempotencyConflictReason, string> = {
  body_mismatch:
    "This Idempotency-Key was already used with a different request body.",
  in_progress:
    "The original request with this Idempotency-Key is still in progress; retry shortly.",
};

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
 */
export function fingerprintRequestBody(body: unknown): string {
  return sha256(stableStringify(body));
}

/** What a handler hands back: the status and body it wants answered with. */
export interface IdempotentHandlerResult<T> {
  status: number;
  body: T;
}

/** The handler ran: its own result, still to be serialised by the route. */
export interface IdempotentExecuted<T> extends IdempotentHandlerResult<T> {
  replayed: false;
}

/**
 * The handler did not run: the exact bytes the first execution answered with.
 *
 * Carried as a string rather than a parsed object so the replay cannot differ
 * from the original by so much as a key order. See {@link withIdempotency}.
 */
export interface IdempotentReplayed {
  replayed: true;
  status: number;
  serializedBody: string;
}

export type IdempotentOutcome<T> = IdempotentExecuted<T> | IdempotentReplayed;

export interface WithIdempotencyParams<T> {
  prisma: PrismaClient;
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
  scopeId,
  key,
  validatedBody,
  handler,
}: WithIdempotencyParams<T>): Promise<IdempotentOutcome<T>> {
  if (key === null) {
    return { ...(await handler()), replayed: false };
  }

  const requestFingerprint = fingerprintRequestBody(validatedBody);
  const claim = await claimReceipt({
    prisma,
    scopeId,
    key,
    requestFingerprint,
  });

  if (claim.kind === "replay") {
    return {
      replayed: true,
      status: claim.status,
      serializedBody: claim.serializedBody,
    };
  }

  let result: IdempotentHandlerResult<T>;
  try {
    result = await handler();
  } catch (error) {
    await releaseClaim(prisma, claim.receiptId);
    throw error;
  }

  if (result.status >= 200 && result.status < 300) {
    await prisma.idempotencyReceipt.update({
      where: { id: claim.receiptId },
      data: {
        responseStatus: result.status,
        // The bytes the route is about to write, not the object behind them,
        // so a replay reproduces this response rather than re-deriving it.
        responseBody: encrypt(serializeResponseBody(result.body)),
      },
    });
  } else {
    await releaseClaim(prisma, claim.receiptId);
  }

  return { ...result, replayed: false };
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
  | { kind: "claimed"; receiptId: string }
  | { kind: "replay"; status: number; serializedBody: string };

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

    const receiptId = await insertPendingReceipt({
      prisma,
      scopeId,
      key,
      requestFingerprint,
      now,
    });
    if (receiptId !== null) return { kind: "claimed", receiptId };

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
    if (verdict.kind === "replay") return verdict;
  }

  // Every attempt lost its insert and then found the row gone. Something is
  // clearing rows underneath us; answer as contention rather than spinning.
  throw new IdempotencyConflictError("in_progress");
}

/** The pending row's id, or null when the key was already taken. */
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
}): Promise<string | null> {
  try {
    const created = await prisma.idempotencyReceipt.create({
      data: {
        scopeId,
        key,
        requestFingerprint,
        expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS),
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
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
}): Promise<Claim | { kind: "retry" }> {
  // Expiry is read before anything else, so a key past its lifetime is a
  // fresh key regardless of what the stale row happens to say.
  if (existing.expiresAt.getTime() <= now.getTime()) {
    await releaseClaim(prisma, existing.id);
    return { kind: "retry" };
  }

  // Ahead of the pending branch: a caller reusing one key for two different
  // bodies has made a mistake worth naming, whether or not the first request
  // has finished.
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new IdempotencyConflictError("body_mismatch");
  }

  if (existing.responseStatus === null) {
    if (now.getTime() - existing.createdAt.getTime() < PENDING_TAKEOVER_MS) {
      throw new IdempotencyConflictError("in_progress");
    }
    // Older than the window: whoever inserted this is not coming back.
    await releaseClaim(prisma, existing.id);
    return { kind: "retry" };
  }

  const serializedBody = readStoredBody(existing);
  // Nothing readable to replay, so the receipt cannot answer for the key. Same
  // handling as expiry: drop it and let the request through as a first use,
  // which is strictly better than refusing a create the caller can never make.
  if (serializedBody === null) {
    await releaseClaim(prisma, existing.id);
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
 * Drop a receipt, by id.
 *
 * `deleteMany` rather than `delete` so a row already cleared by a concurrent
 * attempt is not a second error on top of whatever is being handled.
 */
async function releaseClaim(
  prisma: PrismaClient,
  receiptId: string,
): Promise<void> {
  try {
    await prisma.idempotencyReceipt.deleteMany({ where: { id: receiptId } });
  } catch (error) {
    // Called on the failure path, where the caller is already propagating
    // something more informative. A receipt left pending expires on its own.
    logger.warn(
      { receiptId, error },
      "Failed to release a pending idempotency receipt",
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
