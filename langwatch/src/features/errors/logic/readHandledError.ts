import {
  goErrorCodes,
  type HandledErrorFault,
  nodeErrorCodes,
  type SerializedHandledError,
  type SerializedReason,
} from "@langwatch/handled-error";

import { APP_ERROR_CODES } from "./codes";

/**
 * The client-side view of a handled error, lifted off whatever transport
 * carried it.
 *
 * Deliberately NOT a re-export of `SerializedHandledError`: this is the shape
 * after validation of untrusted input, so every optional field is narrowed to
 * something the UI can render without further checks. A malformed payload
 * yields `null` from {@link readHandledError} rather than a partially-trusted
 * object.
 */
export interface HandledErrorShape {
  code: string;
  meta: Record<string, unknown>;
  httpStatus: number;
  fault: HandledErrorFault;
  tips: readonly string[];
  docsUrl: string | undefined;
  traceId: string | undefined;
  reasons: readonly SerializedReason[];
}

const FAULTS = new Set<string>(["customer", "platform", "provider"]);

/**
 * Lifts the handled-error payload the server attaches at the boundary
 * (`data.error` — see `src/server/api/trpc.ts`), returning `null` when the
 * failure was not handled (an infrastructure fault, a bug) and therefore has
 * nothing structured to say.
 *
 * `null` is the signal to fall back to the generic unknown treatment. It is a
 * correct, expected outcome — see ADR-045.
 *
 * Trusts nothing: the input is `unknown` and a misconfigured or older server
 * must not be able to crash a render by omitting a field.
 */
export function readHandledError(err: unknown): HandledErrorShape | null {
  const candidate = (err as { data?: { error?: unknown } })?.data?.error;
  if (!candidate || typeof candidate !== "object") return null;

  const value = candidate as Record<string, unknown>;

  // `kind` is the deprecated pre-`HandledError` discriminant — read it as a
  // fallback so a payload from an older server (or an older client reading a
  // newer server) still resolves during the transition.
  const code =
    typeof value.code === "string"
      ? value.code
      : typeof value.kind === "string"
        ? value.kind
        : null;
  if (code === null) return null;
  if (typeof value.httpStatus !== "number") return null;

  return {
    code,
    httpStatus: value.httpStatus,
    meta: isRecord(value.meta) ? value.meta : {},
    // The server defaults this, but an older payload may predate the field.
    // `customer` matches the server-side default rather than inventing a
    // different one on the client.
    fault:
      typeof value.fault === "string" && FAULTS.has(value.fault)
        ? (value.fault as HandledErrorFault)
        : "customer",
    tips: Array.isArray(value.tips)
      ? value.tips.filter((tip): tip is string => typeof tip === "string")
      : [],
    docsUrl: safeDocsUrl(value.docsUrl),
    traceId: typeof value.traceId === "string" ? value.traceId : undefined,
    reasons: Array.isArray(value.reasons)
      ? (value.reasons.filter(isRecord) as unknown as SerializedReason[])
      : [],
  };
}

/**
 * The trace id for any error, handled or not.
 *
 * Unhandled errors carry no handled payload by design, but support still needs
 * something to correlate on — the boundary attaches `data.traceId` for exactly
 * this case.
 */
export function readErrorTraceId(err: unknown): string | undefined {
  const handled = readHandledError(err);
  if (handled?.traceId) return handled.traceId;

  const traceId = (err as { data?: { traceId?: unknown } })?.data?.traceId;
  return typeof traceId === "string" ? traceId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * A docs link, or nothing.
 *
 * `docsUrl` ends up in an `href` (see `components/ErrorActions.tsx`), and
 * neither React nor Chakra sanitises one — so `javascript:…` here would run in
 * the app's own origin the moment a customer clicked "Read the docs". A
 * `typeof === "string"` check is not enough for a field that becomes a link.
 *
 * The value is server-authored today (`app-layer/error-remediation.ts` builds
 * it from a static registry), but it does not stay that way: a handled error
 * relayed from a Go service arrives via `nlpgo/goHandledError.ts`, which parses
 * `docs_url` out of an upstream response body with a plain `z.string()`. That
 * body comes from whatever model-provider endpoint the customer configured.
 * This module's own docblock says it trusts nothing; this is the field that
 * didn't.
 */
function safeDocsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;

  try {
    // Absolute-only, deliberately: a relative link would resolve against
    // whatever page the error happened on and go somewhere arbitrary.
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Narrows a `SerializedHandledError` — the shape carried on an event payload
 * (e.g. a `target_result.domainError`) rather than under `data.error` — to the
 * client-side `HandledErrorShape` the presentation layer reads.
 *
 * Use this when the handled error already arrived structured on the event, so
 * there is nothing to lift or validate off an untrusted envelope; for a raw
 * transport error, use {@link readHandledError} instead.
 */
export function handledShapeFromSerialized(
  serialized: SerializedHandledError,
): HandledErrorShape {
  return {
    code: serialized.code,
    meta: serialized.meta,
    httpStatus: serialized.httpStatus,
    fault: serialized.fault,
    tips: serialized.tips ?? [],
    // Validated here as well as in `readHandledError`: this is the path a Go
    // service's error takes, and `nlpgo/goHandledError.ts` parses `docs_url`
    // off an upstream body with a bare `z.string()`.
    docsUrl: safeDocsUrl(serialized.docsUrl),
    traceId: serialized.traceId,
    reasons: serialized.reasons,
  };
}

/**
 * Every code the platform can put on the wire as a message.
 *
 * Checking membership beats guessing at the shape: a regex requiring an
 * underscore lets single-word codes through, and the registry has several
 * (`unauthorized`, `not_found`), so `"unauthorized"` would have been rendered
 * to the customer as though it were a sentence.
 */
const KNOWN_CODES = new Set<string>([
  ...APP_ERROR_CODES,
  ...Object.keys(goErrorCodes),
  // Node failures reach the browser on workflow execution state, and the
  // registry is exhaustive over them too. Leaving them out worked only by
  // accident — they happen to be slug-shaped, so the heuristic below caught
  // them — which is not a reason to rely on the heuristic.
  ...Object.keys(nodeErrorCodes),
]);

/** Belt and braces for a code newer than this client: still slug-shaped. */
const SLUG_SHAPED = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/**
 * Prose a procedure deliberately authored for the user, on an error that isn't
 * a HandledError.
 *
 * #5984 collapsed the wire message to the code for *handled* errors, and to a
 * generic string for unhandled 5xx — but it deliberately left a plain non-5xx
 * `TRPCError`'s message alone, because that is copy the procedure wrote to be
 * read ("User already exists", "Too many signup attempts"). Several hundred
 * such throw sites exist, and dropping their message in favour of "we've been
 * notified" is worse than the slug problem this module set out to fix: it
 * tells a user to wait for something that will never change.
 *
 * The server decides what counts as authored — it needs `cause`, which never
 * crosses the wire — and says so with `data.authored`. This function trusts
 * that flag and then applies a second, independent layer: a message that
 * somehow arrives marked authored but reads like a machine wrote it is still
 * refused. Belt and braces, because the cost of being wrong here is a Prisma
 * string in front of a customer.
 */
export function readAuthoredMessage(err: unknown): string | undefined {
  if (readHandledError(err)) return undefined;

  const data = (err as { data?: { httpStatus?: unknown; authored?: unknown } })
    ?.data;

  // The fact, not a guess about it. Without this the channel also carried
  // `new TRPCError({ code: "NOT_FOUND" })` — whose message tRPC defaults to
  // the code NAME, so the customer read "NOT_FOUND" — and every 4xx built
  // around a `cause`, whose message is the caught error's.
  if (data?.authored !== true) return undefined;

  const status = data.httpStatus;
  if (typeof status !== "number" || status >= 500) return undefined;

  const message = (err as { message?: unknown })?.message;
  if (typeof message !== "string" || message.length === 0) return undefined;

  if (KNOWN_CODES.has(message) || SLUG_SHAPED.test(message)) return undefined;
  if (SCREAMING_CASE.test(message)) return undefined;
  if (message.length > MAX_AUTHORED_LENGTH) return undefined;
  if (MACHINE_PROSE.test(message)) return undefined;

  return message;
}

/**
 * Longer than this and nobody wrote it for a customer.
 *
 * Authored copy is a sentence or two ("That project name is already taken").
 * A stack frame, a serialised query, or a driver's diagnostic block runs to
 * hundreds of characters, and length alone separates them reliably.
 */
const MAX_AUTHORED_LENGTH = 200;

/** `NOT_FOUND`, `UNAUTHORIZED` — a tRPC code name, not a sentence. */
const SCREAMING_CASE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Shapes that mean a machine wrote this string, not a person.
 *
 * The second layer behind `data.authored`, and deliberately conservative in
 * the other direction: every pattern here has to be something no product
 * person would ever type, because a false positive silently replaces good
 * copy with "we've been notified".
 *
 * That is why this is case-SENSITIVE. An earlier version matched SQL keywords
 * case-insensitively and would have eaten "Select a template from the list
 * before running this." — real copy, killed by a guard nobody would think to
 * look at. Likewise the stack-frame pattern is anchored to a line start, and
 * the address pattern requires a port, so "The IP 10.0.0.1 is not allowed as a
 * webhook destination" survives.
 */
const MACHINE_PROSE = new RegExp(
  [
    "\\bprisma\\.", // Invalid `prisma.user.create()` invocation
    "\\bPrismaClient",
    // Upper-case only: SQL is shouted, prose is not.
    "\\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\\b.*\\b(?:FROM|WHERE|VALUES|SET)\\b",
    "\\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN)\\b",
    "(?:^|\\n)\\s*at\\s+\\S+\\s+\\(", // a stack frame, at a line start
    "\\b[A-Z]\\w*Error:\\s", // "TypeError: ...", "SyntaxError: ..."
    "\\bnode_modules\\b",
    "\\b\\d{1,3}(?:\\.\\d{1,3}){3}:\\d+", // an address WITH a port
    "\\b(?:invocation|constraint failed|deadlock detected)\\b",
  ].join("|"),
);
