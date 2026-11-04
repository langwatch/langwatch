/**
 * Test harness: loads the generated pi extension as pi would, drives it with a
 * fake event bus, and decodes what it exports with a protobuf reader of its
 * own, so the encoder is never checked against itself. Not a test file.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { piExtensionSource } from "../pi-extension-source";

type Handler = (event: unknown, ctx: unknown) => unknown;

/** The slice of pi's ExtensionAPI the extension touches: `on`. */
export interface FakePi {
  handlers: Map<string, Handler[]>;
  emit(name: string, event?: unknown, ctx?: unknown): Promise<void>;
}

/** Writes the extension into `dir` and loads it into a fresh module instance. */
export async function loadPiExtension({ dir }: { dir: string }): Promise<FakePi> {
  const file = path.join(dir, `pi-extension-${Date.now()}-${Math.random()}.mjs`);
  fs.writeFileSync(file, piExtensionSource());
  const module = (await import(pathToFileURL(file).href)) as {
    default: (pi: { on(name: string, handler: Handler): void }) => void;
  };
  const handlers = new Map<string, Handler[]>();
  module.default({
    on: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  });
  return {
    handlers,
    emit: async (name, event = {}, ctx = {}) => {
      for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
    },
  };
}

/** A pi handler context for session `sessionId`, running in `cwd`. */
export const piContext = ({
  sessionId,
  cwd = "/repo",
  aborted = false,
}: {
  sessionId: string;
  cwd?: string;
  aborted?: boolean;
}) => ({
  cwd,
  sessionManager: { getSessionId: () => sessionId },
  signal: { aborted },
  model: { id: "claude-sonnet-4-5", provider: "anthropic", api: "anthropic-messages" },
});

type Field = { wire: number; value: bigint | Uint8Array };

/** Every field of one protobuf message, in order, without a schema. */
function readFields(bytes: Uint8Array): Map<number, Field[]> {
  const fields = new Map<number, Field[]>();
  let offset = 0;
  const readVarint = (): bigint => {
    let result = BigInt(0);
    let shift = BigInt(0);
    for (;;) {
      const byte = bytes[offset++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += BigInt(7);
    }
  };
  while (offset < bytes.length) {
    const key = Number(readVarint());
    const number = key >> 3;
    const wire = key & 7;
    let value: bigint | Uint8Array;
    if (wire === 0) value = readVarint();
    else if (wire === 1) {
      value = bytes.slice(offset, offset + 8);
      offset += 8;
    } else if (wire === 2) {
      const length = Number(readVarint());
      value = bytes.slice(offset, offset + length);
      offset += length;
    } else throw new Error(`unexpected wire type ${wire}`);
    fields.set(number, [...(fields.get(number) ?? []), { wire, value }]);
  }
  return fields;
}

const bytesOf = (fields: Map<number, Field[]>, number: number): Uint8Array[] =>
  (fields.get(number) ?? []).map((field) => field.value as Uint8Array);
const textOf = (bytes: Uint8Array | undefined): string | undefined =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes);
const hexOf = (bytes: Uint8Array | undefined): string | undefined =>
  bytes === undefined ? undefined : Buffer.from(bytes).toString("hex");

function anyValueOf(bytes: Uint8Array): string | boolean | number {
  const fields = readFields(bytes);
  if (fields.has(1)) return textOf(bytesOf(fields, 1)[0])!;
  if (fields.has(2)) return fields.get(2)![0]!.value === BigInt(1);
  if (fields.has(3)) return Number(fields.get(3)![0]!.value);
  const raw = fields.get(4)![0]!.value as Uint8Array;
  return new DataView(raw.buffer, raw.byteOffset, 8).getFloat64(0, true);
}

function attributesOf(encoded: Uint8Array[]): Record<string, string | boolean | number> {
  return Object.fromEntries(
    encoded.map((bytes) => {
      const fields = readFields(bytes);
      return [textOf(bytesOf(fields, 1)[0])!, anyValueOf(bytesOf(fields, 2)[0]!)];
    }),
  );
}

export interface DecodedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  attributes: Record<string, string | boolean | number>;
  /** OTLP status code: 0 unset, 2 error. */
  statusCode: number;
}

export interface DecodedExport {
  resource: Record<string, string | boolean | number>;
  scopeName: string;
  spans: DecodedSpan[];
}

/** Decodes one ExportTraceServiceRequest body. */
export function decodeTraces(body: Uint8Array): DecodedExport {
  const resourceSpans = readFields(bytesOf(readFields(body), 1)[0]!);
  const resource = readFields(bytesOf(resourceSpans, 1)[0]!);
  const scopeSpans = readFields(bytesOf(resourceSpans, 2)[0]!);
  const scope = readFields(bytesOf(scopeSpans, 1)[0]!);
  const spans = bytesOf(scopeSpans, 2).map((bytes): DecodedSpan => {
    const span = readFields(bytes);
    const status = bytesOf(span, 15)[0];
    return {
      traceId: hexOf(bytesOf(span, 1)[0])!,
      spanId: hexOf(bytesOf(span, 2)[0])!,
      parentSpanId: hexOf(bytesOf(span, 4)[0]),
      name: textOf(bytesOf(span, 5)[0])!,
      attributes: attributesOf(bytesOf(span, 9)),
      statusCode:
        status === undefined ? 0 : Number(readFields(status).get(3)?.[0]?.value ?? BigInt(0)),
    };
  });
  return {
    resource: attributesOf(bytesOf(resource, 1)),
    scopeName: textOf(bytesOf(scope, 1)[0])!,
    spans,
  };
}

/** One POST the extension made, as the collector saw it. */
export interface ExportedRequest {
  url: string;
  headers: Record<string, string>;
  decoded: DecodedExport;
}

/** A `fetch` that answers 200 and records every export it is handed. */
export function recordingCollector(): { requests: ExportedRequest[]; fetch: typeof fetch } {
  const requests: ExportedRequest[] = [];
  const fake = (async (
    url: string,
    init: { headers: Record<string, string>; body: Uint8Array },
  ) => {
    requests.push({ url, headers: init.headers, decoded: decodeTraces(init.body) });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return { requests, fetch: fake };
}
