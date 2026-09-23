/**
 * A route that does not answer with JSON says which kind of answer it gives,
 * and is handed the one producer that makes that kind. Nothing else makes one:
 * the answer carries a brand only these producers put on it.
 */
import type { StatusCode } from "hono/utils/http-status";

import { readableByteStream } from "./byte-stream.ts";
import { declined, type Declined } from "./response.ts";

/**
 * The kinds of answer that are not JSON. Each is a different job for the
 * framework - headers, framing, what the document publishes - which is why
 * they are named apart rather than sharing one raw hatch.
 */
export type RestResponseKind = "bytes" | "sse" | "redirect" | "protocol" | "forwarded";

/** The brand a produced answer carries, and the runtime refuses an answer without. */
const PRODUCED: unique symbol = Symbol.for("@langwatch/api/rest/produced");

/** The four shapes the runtime knows how to write, whatever kind produced them. */
export type RestAnswerBody =
  | Readonly<{ form: "bytes"; bytes: Uint8Array<ArrayBuffer> | string | null }>
  | Readonly<{ form: "stream"; stream: ReadableStream }>
  | Readonly<{ form: "events"; events: AsyncIterable<RestEvent> }>
  | Readonly<{ form: "response"; response: Response }>;

/**
 * What a handler on a declared kind returns. `Kind` is phantom on purpose: it
 * is what makes an SSE answer unusable on a bytes route, and a hand-built
 * `Response` unusable on either.
 */
export type RestAnswer<Kind extends RestResponseKind> = Readonly<{
  readonly [PRODUCED]: Kind;
  readonly status: StatusCode;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: RestAnswerBody;
}>;

/** One server-sent event, as the framework will frame it. */
export type RestEvent = Readonly<{
  event?: string;
  data: string;
  id?: string;
  retryMs?: number;
}>;

/**
 * The media type a producer may name: the ones the declaration published, or
 * any type at all when one of them is a wildcard, since a wildcard is the
 * declaration saying it cannot know.
 */
type MediaTypeOf<Named extends string> = Named extends `${string}*${string}` ? string : Named;
export type ProducedMediaType<Produces extends string | readonly string[]> =
  Produces extends readonly string[]
    ? MediaTypeOf<Produces[number]>
    : MediaTypeOf<Produces & string>;

/** What a bytes route hands over, and what the framework derives from it. */
export type RestBytesProducer<Produces extends string | readonly string[] = string> = Readonly<{
  /** Bytes already in hand: `Content-Length` and the disposition follow from them. */
  buffer(
    bytes: Uint8Array | string,
    options: Readonly<{
      mediaType: ProducedMediaType<Produces>;
      filename?: string;
      cacheSeconds?: number;
    }>,
  ): RestAnswer<"bytes">;
  /** Bytes still arriving. `byteLength` is published when the store knows it. */
  stream(
    stream: ReadableStream | AsyncIterable<Uint8Array>,
    options: Readonly<{
      mediaType: ProducedMediaType<Produces>;
      status?: StatusCode;
      onCancel?: (reason: unknown) => void | Promise<void>;
      byteLength?: number;
      headers?: Readonly<Record<string, string>>;
      disposition?: "inline" | "attachment";
      filename?: string;
      cacheSeconds?: number;
    }>,
  ): RestAnswer<"bytes">;
  /** The bytes live in a store that can sign for them, so the caller fetches them there. */
  storedAt(url: string, options: Readonly<{ seconds: number }>): RestAnswer<"bytes">;
  /** The caller's validator still matches, so there are no bytes to send. */
  notModified(
    options?: Readonly<{ headers?: Readonly<Record<string, string>> }>,
  ): RestAnswer<"bytes">;
}>;

/** What an event-stream route hands over: the events, never the framing. */
export type RestEventsProducer = Readonly<{
  events(source: AsyncIterable<RestEvent>): RestAnswer<"sse">;
}>;

/** What a redirecting route hands over: where the caller goes, and for how long. */
export type RestRedirectProducer = Readonly<{
  to(
    location: string,
    options?: Readonly<{ permanent?: boolean; preserveMethod?: boolean }>,
  ): RestAnswer<"redirect">;
}>;

/**
 * What a foreign protocol's route hands over. The bytes are written exactly as
 * given - this is the kind for a wire we do not own (SCIM, OAuth, a legacy
 * family), which is why the declaration must say why.
 */
export type RestProtocolProducer<Produces extends string | readonly string[] = string> = Readonly<{
  write(
    options: Readonly<{
      status: StatusCode;
      mediaType: ProducedMediaType<Produces>;
      body: Uint8Array | string | null;
      headers?: Readonly<Record<string, string>>;
    }>,
  ): RestAnswer<"protocol">;
}>;

/**
 * How a foreign protocol answers a refusal: every failure its route raises,
 * the door's and the parser's included, written in the protocol's own document.
 */
export type RestProtocolRefusal = (
  refused: Readonly<{ failure: Error; response: RestRefusalProducer }>,
) => RestAnswer<"protocol">;

/** What a refusal writes: a failure carries its status as a plain number, not a declared one. */
export type RestRefusalProducer = Readonly<{
  write(
    options: Readonly<{ status: number; mediaType: string; body: string }>,
  ): RestAnswer<"protocol">;
}>;

/** What a route that answers with someone else's response hands over. */
export type RestForwardedProducer = Readonly<{
  pass(response: Response): RestAnswer<"forwarded">;
  /** Recognised nothing of its own; an any-method route alone may say so. */
  decline(): Declined;
}>;

/** One producer per kind, as the table both the type and the runtime read. */
type ProducerByKind<Produces extends string | readonly string[]> = Readonly<{
  bytes: RestBytesProducer<Produces>;
  sse: RestEventsProducer;
  redirect: RestRedirectProducer;
  protocol: RestProtocolProducer<Produces>;
  forwarded: RestForwardedProducer;
}>;

/** The producer a route of each kind is handed, and nothing wider. */
export type RestProducerFor<
  Kind extends RestResponseKind,
  Produces extends string | readonly string[] = string,
> = ProducerByKind<Produces>[Kind];

/** What such a handler may return: its own kind's answer, and a decline if it forwards. */
export type RestProducedFor<Kind extends RestResponseKind> = Kind extends "forwarded"
  ? RestAnswer<"forwarded"> | Declined
  : RestAnswer<Kind>;

/** The `answer` slot of a route that declared a kind: the kind, and what it publishes. */
export type RestResponseDeclared<
  Kind extends RestResponseKind = RestResponseKind,
  Produces extends string | readonly string[] = string | readonly string[],
> = Readonly<{ responseKind: Kind; produced: Produces }>;

/** What the declaration records, and the runtime reads to write the answer. */
export type RestResponseDeclaration = Readonly<{
  kind: RestResponseKind;
  produces: readonly string[];
  /** Why a wire we do not own is written here; required of the two escape kinds. */
  because?: string;
  /** A protocol route's own refusal document, in place of the family's error boundary. */
  refusal?: RestProtocolRefusal;
}>;

function answer<Kind extends RestResponseKind>(
  kind: Kind,
  status: StatusCode,
  headers: Record<string, string>,
  body: RestAnswerBody,
): RestAnswer<Kind> {
  return Object.freeze({ [PRODUCED]: kind, status, headers, body });
}

/**
 * `Content-Disposition` for a name a caller chose: quoted, with every quote,
 * backslash and control character taken out, so a filename cannot write a
 * second header field.
 */
function disposition(
  filename: string,
  kind: "inline" | "attachment" = "inline",
): Record<string, string> {
  const safe = filename.replace(/["\\]/g, "").replace(/[^\x20-\x7e]/g, "");

  return safe === "" ? {} : { "Content-Disposition": `${kind}; filename="${safe}"` };
}

/**
 * The bytes as the web's `Response` takes them. A view over shared memory is
 * copied rather than refused, because a store's buffer is not the handler's
 * choice and nothing downstream can read it.
 */
function bytesOf(bytes: Uint8Array | string): Uint8Array<ArrayBuffer> | string {
  if (typeof bytes === "string") return bytes;

  return bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
}

function caching(seconds: number | undefined): Record<string, string> {
  return seconds === undefined ? {} : { "Cache-Control": `private, max-age=${seconds}` };
}

const BYTES_PRODUCER: RestBytesProducer = Object.freeze({
  buffer(bytes, options) {
    const length =
      typeof bytes === "string" ? new TextEncoder().encode(bytes).byteLength : bytes.byteLength;

    return answer(
      "bytes",
      200,
      {
        "Content-Type": options.mediaType,
        "Content-Length": String(length),
        ...disposition(options.filename ?? ""),
        ...caching(options.cacheSeconds),
      },
      { form: "bytes", bytes: bytesOf(bytes) },
    );
  },
  stream(stream, options) {
    return answer(
      "bytes",
      options.status ?? 200,
      {
        ...options.headers,
        "Content-Type": options.mediaType,
        ...(options.byteLength === undefined
          ? {}
          : { "Content-Length": String(options.byteLength) }),
        ...disposition(options.filename ?? "", options.disposition),
        ...caching(options.cacheSeconds),
      },
      { form: "stream", stream: readableByteStream(stream, options.onCancel) },
    );
  },
  storedAt(url, options) {
    return answer(
      "bytes",
      302,
      { Location: url, "Cache-Control": `private, max-age=${options.seconds}` },
      { form: "bytes", bytes: null },
    );
  },
  notModified(options) {
    return answer("bytes", 304, { ...options?.headers }, { form: "bytes", bytes: null });
  },
});

const EVENTS_PRODUCER: RestEventsProducer = Object.freeze({
  events(source) {
    return answer(
      "sse",
      200,
      {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
      { form: "events", events: source },
    );
  },
});

/**
 * Which redirect the caller is given: 303 turns a POST into a GET of the new
 * place, which is what a form wants; the 307/308 pair is for the caller that
 * must repeat what it sent.
 */
function redirectStatus(permanent: boolean, preserveMethod: boolean): StatusCode {
  if (preserveMethod) return permanent ? 308 : 307;

  return permanent ? 301 : 303;
}

const REDIRECT_PRODUCER: RestRedirectProducer = Object.freeze({
  to(location, options) {
    return answer(
      "redirect",
      redirectStatus(options?.permanent === true, options?.preserveMethod === true),
      { Location: location },
      { form: "bytes", bytes: null },
    );
  },
});

const PROTOCOL_PRODUCER: RestProtocolProducer = Object.freeze({
  write(options) {
    return answer(
      "protocol",
      options.status,
      { "Content-Type": options.mediaType, ...options.headers },
      { form: "bytes", bytes: options.body === null ? null : bytesOf(options.body) },
    );
  },
});

const FORWARDED_PRODUCER: RestForwardedProducer = Object.freeze({
  // The forwarded response carries its own status and headers, so the answer's
  // are never read: the runtime writes the response it was handed, verbatim.
  pass(response) {
    return answer("forwarded", 200, {}, { form: "response", response });
  },
  decline: declined,
});

const PRODUCERS = {
  bytes: BYTES_PRODUCER,
  sse: EVENTS_PRODUCER,
  redirect: REDIRECT_PRODUCER,
  protocol: PROTOCOL_PRODUCER,
  forwarded: FORWARDED_PRODUCER,
} as const satisfies Record<RestResponseKind, unknown>;

/** An HTTP status a response can carry; anything else a refusal names is a 500. */
function isStatusCode(status: number): status is StatusCode {
  return Number.isInteger(status) && status >= 100 && status <= 599;
}

const REFUSAL_PRODUCER: RestRefusalProducer = Object.freeze({
  write(options) {
    return PROTOCOL_PRODUCER.write({
      status: isStatusCode(options.status) ? options.status : 500,
      mediaType: options.mediaType,
      body: options.body,
    });
  },
});

/** The producer a protocol route's refusal writes through. */
export function refusalProducer(): RestRefusalProducer {
  return REFUSAL_PRODUCER;
}

/** The producer for a declared kind, as the runtime hands it to the handler. */
export function producerFor(kind: RestResponseKind): (typeof PRODUCERS)[RestResponseKind] {
  return PRODUCERS[kind];
}

/** Whether a handler's result came from a producer, rather than being hand-built. */
export function isProducedAnswer(result: unknown): result is RestAnswer<RestResponseKind> {
  return typeof result === "object" && result !== null && PRODUCED in result;
}

/** The kind that produced an answer, for the runtime's own assert. */
export function producedKind(answered: RestAnswer<RestResponseKind>): RestResponseKind {
  return answered[PRODUCED];
}

/** The two kinds that write a wire we do not own, and so must say why. */
export function kindNeedsReason(kind: RestResponseKind): boolean {
  return kind === "protocol" || kind === "forwarded";
}

/** What a kind publishes when the declaration named no media type of its own. */
export function defaultProducesFor(kind: RestResponseKind): readonly string[] {
  return kind === "sse" ? ["text/event-stream"] : [];
}
