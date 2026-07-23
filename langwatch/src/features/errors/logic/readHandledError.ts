import {
  goErrorCodes,
  type HandledErrorFault,
  nodeErrorCodes,
  type SerializedHandledError,
  type SerializedReason,
} from "@langwatch/handled-error";

import { getDocsBaseUrl } from "~/utils/docsUrl";

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
 * Lifts the handled-error payload off whichever transport carried it,
 * returning `null` when the failure was not handled (an infrastructure fault,
 * a bug) and therefore has nothing structured to say.
 *
 * Two shapes, because the platform has two boundaries:
 *   - tRPC nests it under `data.error` (see `src/server/api/trpc.ts`);
 *   - a Hono REST route sends it FLAT (`src/app/api/middleware/error-handler.ts`
 *     puts the code in `error`, spreads `meta` at the top level, and hangs the
 *     trace off `trace`).
 *
 * `null` is the signal to fall back to the generic unknown treatment. It is a
 * correct, expected outcome — see ADR-045.
 *
 * Trusts nothing: the input is `unknown` and a misconfigured or older server
 * must not be able to crash a render by omitting a field.
 */
export function readHandledError(err: unknown): HandledErrorShape | null {
  return fromTrpcEnvelope(err) ?? fromRestBody(err);
}

/** The tRPC shape: the whole payload under `data.error`. */
function fromTrpcEnvelope(err: unknown): HandledErrorShape | null {
  const candidate = (err as { data?: { error?: unknown } })?.data?.error;
  if (!isRecord(candidate)) return null;

  // `kind` is the deprecated pre-`HandledError` discriminant — read it as a
  // fallback so a payload from an older server (or an older client reading a
  // newer server) still resolves during the transition.
  const code =
    typeof candidate.code === "string"
      ? candidate.code
      : typeof candidate.kind === "string"
        ? candidate.kind
        : null;
  if (code === null) return null;
  if (typeof candidate.httpStatus !== "number") return null;

  return {
    code,
    httpStatus: candidate.httpStatus,
    meta: isRecord(candidate.meta) ? candidate.meta : {},
    fault: safeFault(candidate.fault),
    tips: safeTips(candidate.tips),
    docsUrl: safeDocsUrl(candidate.docsUrl),
    traceId:
      typeof candidate.traceId === "string" ? candidate.traceId : undefined,
    reasons: safeReasons(candidate.reasons),
  };
}

/**
 * The REST shape: `{ error: "<code>", message, ...meta, tips, docsUrl, fault }`
 * with the trace ids under `trace`.
 *
 * Without this, every handled error raised by a Hono route reached the UI as an
 * unhandled one — no registry copy, no docs link, no trace id — even though the
 * server had said exactly what went wrong. The routes are the surface the CLI
 * and agents use, so this is not a rare path.
 *
 * The code is the discriminant AND the guard: an unhandled REST failure sends
 * `{ error: "Internal server error" }` (and a Prisma conflict `"Conflict"`),
 * so requiring a slug keeps prose out of the code slot rather than presenting
 * "Internal server error" as though it were a registered code.
 */
function fromRestBody(err: unknown): HandledErrorShape | null {
  if (!isRecord(err)) return null;

  const code = err.error;
  if (typeof code !== "string") return null;
  if (!KNOWN_CODES.has(code) && !SLUG_SHAPED.test(code)) return null;

  const trace = isRecord(err.trace) ? err.trace : undefined;

  return {
    code,
    // The flat body carries no status of its own — it IS the HTTP status, which
    // lives on the response rather than in it. Read one if a fetch wrapper
    // stamped it; nothing in the presentation layer needs it either way.
    httpStatus:
      typeof err.httpStatus === "number"
        ? err.httpStatus
        : typeof err.status === "number"
          ? err.status
          : 0,
    meta: restMeta(err),
    fault: safeFault(err.fault),
    tips: safeTips(err.tips),
    docsUrl: safeDocsUrl(err.docsUrl),
    traceId: typeof trace?.traceId === "string" ? trace.traceId : undefined,
    reasons: safeReasons(err.reasons),
  };
}

/**
 * The envelope keys of a flat REST error body. Everything else was `meta`,
 * spread at the top level by `handledErrorResponseBody`.
 *
 * `message` is folded back into `meta.message` rather than dropped: it is the
 * handled error's own sentence, which is the one channel the registry reads
 * for a code it has no copy for.
 */
const REST_ENVELOPE_KEYS = new Set([
  "error",
  "code",
  "message",
  "tips",
  "docsUrl",
  "fault",
  "reasons",
  "trace",
  "httpStatus",
  "status",
]);

function restMeta(body: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (REST_ENVELOPE_KEYS.has(key)) continue;
    meta[key] = value;
  }
  if (typeof body.message === "string") meta.message = body.message;
  return meta;
}

/**
 * The trace id for any error, handled or not.
 *
 * Unhandled errors carry no handled payload by design, but support still needs
 * something to correlate on — each boundary attaches one for exactly this case
 * (`data.traceId` over tRPC, `trace.traceId` over REST).
 */
export function readErrorTraceId(err: unknown): string | undefined {
  const handled = readHandledError(err);
  if (handled?.traceId) return handled.traceId;

  const traceId = (err as { data?: { traceId?: unknown } })?.data?.traceId;
  if (typeof traceId === "string") return traceId;

  const trace = (err as { trace?: unknown })?.trace;
  const restTraceId = isRecord(trace) ? trace.traceId : undefined;
  return typeof restTraceId === "string" ? restTraceId : undefined;
}

/**
 * The server defaults this, but an older payload may predate the field.
 * `customer` matches the server-side default rather than inventing a different
 * one on the client — and an absent one must never index `FAULT_TITLES` with
 * `undefined`, which renders the literal string "undefined" at a customer.
 */
function safeFault(value: unknown): HandledErrorFault {
  return typeof value === "string" && FAULTS.has(value)
    ? (value as HandledErrorFault)
    : "customer";
}

/**
 * Remediation tips, bounded in both directions.
 *
 * These ride the same untrusted relay path `meta.message` is clamped for — a
 * Go service parses them off an upstream body — so an upstream that answers
 * with fifty paragraphs must not get to render fifty paragraphs inside
 * LangWatch's own error chrome. `<HandledErrorAlert>` lists all of them.
 */
function safeTips(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tip): tip is string => typeof tip === "string")
    .slice(0, MAX_TIPS)
    .map(safeProse)
    .filter((tip) => tip.length > 0);
}

/** More than this is a document, not remediation. */
const MAX_TIPS = 4;

function safeReasons(value: unknown): readonly SerializedReason[] {
  return Array.isArray(value)
    ? (value.filter(isRecord) as unknown as SerializedReason[])
    : [];
}

/**
 * Server prose, clamped to something that can only ever be a sentence.
 *
 * The payload is not always ours: a handled error relayed from a Go service is
 * parsed out of an upstream response body (`nlpgo/goHandledError.ts` forwards
 * `message` and the whole of `meta` verbatim), and that body comes from
 * whatever model-provider endpoint the customer configured. React escapes it,
 * so this is not an injection — but an upstream should not get to write a
 * paragraph inside LangWatch's own error chrome, and a driver diagnostic that
 * lands here should be truncated rather than recited.
 */
export function safeProse(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  if (collapsed.length <= MAX_PROSE_LENGTH) return collapsed;
  // By code point, not code unit: slicing mid-surrogate leaves a lone half
  // that renders as a replacement character right before the ellipsis.
  const kept = [...collapsed].slice(0, MAX_PROSE_LENGTH - 1).join("");
  return `${kept.trimEnd()}…`;
}

const MAX_PROSE_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * The origins a docs link may point at.
 *
 * Derived from the same helper that BUILDS them (`utils/docsUrl`), so the
 * allowlist cannot drift from what the server actually sends: the canonical
 * docs site, and the local Mintlify a developer runs against a localhost app.
 * Passing the hostname explicitly pins each branch without reading
 * `window.location`, which is exactly what that argument exists for.
 */
const DOCS_ORIGINS = new Set(
  ["localhost", "app.langwatch.ai"].map(
    (hostname) => new URL(getDocsBaseUrl(hostname)).origin,
  ),
);

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
 * `docs_url` out of an upstream response body with a plain `z.string()`, and a
 * Langy relay frame does the same. That body comes from whatever endpoint the
 * customer configured, so "any https URL" would let an upstream put its own
 * link behind our "Read the docs" — a phishing surface wearing our chrome.
 * Only our docs origins are accepted.
 */
function safeDocsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;

  try {
    // Absolute-only, deliberately: a relative link would resolve against
    // whatever page the error happened on and go somewhere arbitrary.
    return DOCS_ORIGINS.has(new URL(value).origin) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Narrows a `SerializedHandledError` — the shape carried on an event payload
 * (e.g. a `target_result.domainError`) rather than under `data.error` — to the
 * client-side `HandledErrorShape` the presentation layer reads.
 *
 * Use this when the handled error already arrived structured on the event; for
 * a raw transport error, use {@link readHandledError} instead.
 *
 * The type says these fields are present, and the type is a promise about our
 * own code, not about the bytes on the wire: this is the path a relayed Go
 * error takes, and every field on it was parsed out of an upstream body. So
 * the same narrowing runs here — an absent `fault` indexed `FAULT_TITLES` with
 * `undefined` and rendered the literal "undefined" as a headline, and an
 * absent `meta` made every `meta` read in the registry throw.
 */
export function handledShapeFromSerialized(
  serialized: SerializedHandledError,
): HandledErrorShape {
  return {
    code: serialized.code,
    meta: isRecord(serialized.meta) ? serialized.meta : {},
    httpStatus: serialized.httpStatus,
    fault: safeFault(serialized.fault),
    tips: safeTips(serialized.tips),
    docsUrl: safeDocsUrl(serialized.docsUrl),
    traceId: serialized.traceId,
    reasons: safeReasons(serialized.reasons),
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
