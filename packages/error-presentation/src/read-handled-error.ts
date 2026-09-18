import { APP_ERROR_CODES } from "./app-codes.ts";
import { goErrorCodes, nodeErrorCodes } from "./codes.generated.ts";
import { canonicalDocsBaseUrl, docsBaseUrl } from "./docs-url.ts";
import {
  type HandledErrorFault,
  serializedReasonSchema,
  type SerializedHandledError,
  type SerializedReason,
} from "@langwatch/handled-error";

/**
 * The client-side view of a handled error, lifted off whatever transport
 * carried it. Deliberately NOT a re-export of `SerializedHandledError`: it
 * is the validated shape, safe for the UI to render without further checks.
 */
export interface HandledErrorShape {
  code: string;
  meta: Record<string, unknown>;
  httpStatus: number;
  fault: HandledErrorFault;
  retryable: boolean;
  tips: readonly string[];
  docsUrl: string | undefined;
  traceId: string | undefined;
  reasons: readonly SerializedReason[];
}

const FAULTS = new Set<string>(["customer", "platform", "provider"]);

/**
 * Lifts the handled-error payload off whichever transport carried it, tried
 * in order — tRPC, the canonical envelope, a flat REST body, then the
 * loosest shape last — and returns `null` when unhandled (ADR-045).
 */
export function readHandledError(err: unknown): HandledErrorShape | null {
  return (
    fromTrpcEnvelope(err) ??
    fromCanonicalEnvelope(err) ??
    fromRestBody(err) ??
    fromSerializedPayload(err)
  );
}

/**
 * The envelope-less shape: `HandledError.serialize()` riding an event
 * payload. Read LAST — the loosest shape, so `code` and a numeric
 * `httpStatus` are required together to avoid matching any tagged object.
 */
function fromSerializedPayload(err: unknown): HandledErrorShape | null {
  if (!isRecord(err)) return null;
  if (typeof err.httpStatus !== "number") return null;

  const code =
    typeof err.code === "string" ? err.code : typeof err.kind === "string" ? err.kind : null;
  if (code === null) return null;
  if (!KNOWN_CODES.has(code) && !SLUG_SHAPED.test(code)) return null;

  return {
    code,
    httpStatus: err.httpStatus,
    meta: isRecord(err.meta) ? err.meta : {},
    fault: safeFault(err.fault),
    retryable: err.retryable === true,
    tips: safeTips(err.tips),
    docsUrl: safeDocsUrl(err.docsUrl),
    traceId: typeof err.traceId === "string" ? err.traceId : undefined,
    reasons: safeReasons(err.reasons),
  };
}

/**
 * REST writes canonical error fields at the body root; the Go plane nests them
 * under `error`. The shared reader distinguishes the root form by the `type`,
 * `code`, and `retryable` fields that `apiErrorBody` always emits.
 */
function fromCanonicalEnvelope(err: unknown): HandledErrorShape | null {
  if (!isRecord(err)) return null;
  const envelope = isRecord(err.error) ? err.error : rootEnvelope(err);
  if (!envelope) return null;

  const code = envelopeCode(envelope);
  if (code === null) return null;

  // Remediation is rendered as OUR advice, so it is read only off a code we
  // recognise. A slug-shaped code we do not know may be a provider's own
  // (`insufficient_quota`, `overloaded_error`) nested under `error` in a body
  // that never passed through `pkg/herr` — near enough in shape to parse, and
  // no reason to trust whatever sits beside it in the same object.
  const ours = KNOWN_CODES.has(code);

  return {
    code,
    httpStatus: stampedStatus(err),
    meta: envelopeMeta({ envelope, code }),
    fault: safeFault(ours ? envelope.fault : undefined),
    retryable: envelope.retryable === true,
    tips: safeTips(ours ? envelope.tips : undefined),
    docsUrl: ours ? safeDocsUrl(envelope.docs_url) : undefined,
    traceId: str(envelope.trace_id),
    reasons: safeReasons(envelope.reasons),
  };
}

function rootEnvelope(err: Record<string, unknown>): Record<string, unknown> | undefined {
  const carriesTrio =
    typeof err.type === "string" &&
    typeof err.code === "string" &&
    typeof err.retryable === "boolean";

  return carriesTrio ? err : undefined;
}

/**
 * The envelope's discriminant: `code`, falling back to `type`. Returns null
 * unless slug-shaped — shape alone is not provenance, which is why
 * `fromCanonicalEnvelope` reads remediation fields only for KNOWN_CODES.
 */
function envelopeCode(envelope: Record<string, unknown>): string | null {
  const code = str(envelope.code) ?? str(envelope.type);
  if (code === undefined) return null;
  return KNOWN_CODES.has(code) || SLUG_SHAPED.test(code) ? code : null;
}

/**
 * The structured detail, plus the envelope's own sentence kept under `message`
 * — where the registry looks for it when it has no copy of its own for a code.
 */
function envelopeMeta({
  envelope,
  code,
}: {
  envelope: Record<string, unknown>;
  code: string;
}): Record<string, unknown> {
  const meta = isRecord(envelope.meta) ? { ...envelope.meta } : {};
  const message = str(envelope.message);
  if (message !== undefined && message !== code) {
    meta.message = message;
  }
  return meta;
}

/**
 * The status a fetch wrapper stamped onto the body, if any. The envelope
 * carries no status of its own — it IS the HTTP status, which lives on the
 * response rather than in it.
 */
function stampedStatus(body: Record<string, unknown>): number {
  if (typeof body.httpStatus === "number") return body.httpStatus;
  if (typeof body.status === "number") return body.status;
  return 0;
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

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
    retryable: candidate.retryable === true,
    tips: safeTips(candidate.tips),
    docsUrl: safeDocsUrl(candidate.docsUrl),
    traceId: typeof candidate.traceId === "string" ? candidate.traceId : undefined,
    reasons: safeReasons(candidate.reasons),
  };
}

/**
 * The REST shape: `{ error: "<code>", message, ...meta, tips, docsUrl,
 * fault }`, trace ids under `trace`. The code doubles as the guard: requiring
 * a slug keeps prose like "Internal server error" out of the code slot.
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
    retryable: err.retryable === true,
    tips: safeTips(err.tips),
    docsUrl: safeDocsUrl(err.docsUrl),
    traceId: typeof trace?.traceId === "string" ? trace.traceId : undefined,
    reasons: safeReasons(err.reasons),
  };
}

/**
 * Envelope keys of a flat REST error body; everything else was `meta`.
 * `message` folds back into `meta.message` — the one channel the registry
 * reads for a code it has no copy for.
 */
const REST_ENVELOPE_KEYS = new Set([
  "error",
  "code",
  "message",
  "tips",
  "docsUrl",
  "fault",
  "retryable",
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
 * The trace id for any error, handled or not: unhandled errors carry no
 * handled payload, but each boundary still attaches one to correlate on
 * (`data.traceId` over tRPC, `trace.traceId` over REST).
 */
export function readErrorTraceId(err: unknown): string | undefined {
  const handled = readHandledError(err);
  if (handled?.traceId) return handled.traceId;

  return readEnvelopeTraceId(err);
}

/**
 * The trace id each boundary attaches OUTSIDE the handled payload. Split out
 * of {@link readErrorTraceId} so a caller that already parsed the handled
 * payload can finish the lookup without parsing it a second time.
 */
export function readEnvelopeTraceId(err: unknown): string | undefined {
  const traceId = (err as { data?: { traceId?: unknown } })?.data?.traceId;
  if (typeof traceId === "string") return traceId;

  const trace = (err as { trace?: unknown })?.trace;
  const restTraceId = isRecord(trace) ? trace.traceId : undefined;
  return typeof restTraceId === "string" ? restTraceId : undefined;
}

/**
 * `customer` matches the server-side default for an older payload predating
 * this field — an absent one must never index `FAULT_TITLES` with `undefined`,
 * which renders the literal string "undefined" at a customer.
 */
function safeFault(value: unknown): HandledErrorFault {
  return typeof value === "string" && FAULTS.has(value) ? (value as HandledErrorFault) : "customer";
}

/**
 * Remediation tips, bounded in both directions — they ride the same untrusted
 * relay path `meta.message` is clamped for, so an upstream answering with
 * fifty paragraphs can't render fifty paragraphs in our error chrome.
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
  if (!Array.isArray(value)) return [];

  return value.flatMap((reason) => {
    const parsed = serializedReasonSchema.safeParse(reason);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Server prose, clamped to something that can only ever be a sentence — a
 * length clamp, not a safety boundary. It does NOT make an upstream's
 * sentence safe: only servers that author `meta.message` render it at all.
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

/*
 * Deliberately no `redactSecrets` here: shape-based masking only catches
 * shapes someone thought of, so a scrubber that misses one is worse than
 * none. The real fix is ADR-045 — mint a `HandledError` when we know the cause.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * The origins a docs link may resolve to — computed per call, not pinned as
 * a module constant, because the local origin is attacker-reachable through
 * `docsUrl` and must not leak `localhost:3000` into a production allowlist.
 */
function docsOrigins(): Set<string> {
  return new Set([canonicalDocsBaseUrl(), docsBaseUrl()].map((base) => new URL(base).origin));
}

/**
 * A docs link, or nothing. `docsUrl` lands in an unsanitised `href` (a bare
 * type check isn't enough — `javascript:…` would run in our origin), and only
 * our own docs origins are accepted since an upstream can inject its own link.
 */
function safeDocsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;

  try {
    // Absolute-only, deliberately: a relative link would resolve against
    // whatever page the error happened on and go somewhere arbitrary.
    return docsOrigins().has(new URL(value).origin) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Narrows a `SerializedHandledError` — the event-payload shape — to the
 * client-side `HandledErrorShape`. Use for an already-structured payload;
 * for a raw transport error use {@link readHandledError} instead.
 */
export function handledShapeFromSerialized(serialized: SerializedHandledError): HandledErrorShape {
  return {
    code: serialized.code,
    meta: isRecord(serialized.meta) ? serialized.meta : {},
    httpStatus: serialized.httpStatus,
    fault: safeFault(serialized.fault),
    retryable: serialized.retryable === true,
    tips: safeTips(serialized.tips),
    docsUrl: safeDocsUrl(serialized.docsUrl),
    traceId: serialized.traceId,
    reasons: safeReasons(serialized.reasons),
  };
}

/**
 * Every code the platform can put on the wire as a message. Checking
 * membership beats guessing at shape: a regex requiring an underscore lets
 * single-word codes like `"unauthorized"` through as though it were a sentence.
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
 * Prose a procedure deliberately authored for the user — a plain non-5xx
 * `TRPCError` message (e.g. "User already exists") that #5984 left alone
 * rather than collapsing to a code or a generic line. Trusts `data.authored`.
 */
export function readAuthoredMessage(err: unknown): string | undefined {
  if (readHandledError(err)) return undefined;

  return readAuthoredMessageOfUnhandled(err);
}

/**
 * {@link readAuthoredMessage} minus its handled-error guard — only for a
 * caller that already established `readHandledError` returned `null`, since
 * skipping the guard otherwise would let a handled error's wire code through.
 */
export function readAuthoredMessageOfUnhandled(err: unknown): string | undefined {
  const data = (err as { data?: { httpStatus?: unknown; authored?: unknown } })?.data;

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
 * Longer than this and nobody wrote it for a customer: authored copy is a
 * sentence or two, while a stack frame or diagnostic block runs to hundreds
 * of characters — length alone separates them reliably.
 */
const MAX_AUTHORED_LENGTH = 200;

/** `NOT_FOUND`, `UNAUTHORIZED` — a tRPC code name, not a sentence. */
const SCREAMING_CASE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Shapes that mean a machine wrote this, not a person — deliberately
 * case-SENSITIVE: a case-insensitive SQL match would reject real copy like
 * "Select a template from the list before running this."
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
