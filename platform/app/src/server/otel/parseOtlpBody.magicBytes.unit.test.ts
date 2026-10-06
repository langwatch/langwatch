/**
 * How the shared OTLP body reader picks a decompressor.
 *
 * Some exporters send zstd with no Content-Encoding header, or gzip under a
 * wrong or unlisted one. The header alone used to decide, so those bodies were
 * parsed as raw protobuf and failed. The body's magic bytes now win over the
 * header; a body with no recognised magic keeps header-driven behaviour. Every
 * decoder stays bounded by OTLP_MAX_BODY_BYTES.
 *
 * Spec: specs/otlp/otlp-body-magic-bytes.feature
 */

import {
  brotliCompressSync,
  deflateSync,
  gzipSync,
  zstdCompressSync,
} from "node:zlib";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { describe, expect, it } from "vitest";

import { OtlpBodyTooLargeError, OtlpUnsupportedEncodingError } from "./errors";
import {
  OTLP_MAX_BODY_BYTES,
  parseOtlpTraces,
  readOtlpBody,
} from "./parseOtlpBody";

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

function buildTraceRequest() {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "magic-bytes-test" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "test-scope", version: "1.0.0" },
            spans: [
              {
                traceId: "0123456789abcdef0123456789abcdef",
                spanId: "0123456789abcdef",
                parentSpanId: "",
                name: "magic-span",
                kind: 1,
                startTimeUnixNano: "1700000000000000000",
                endTimeUnixNano: "1700000000100000000",
                attributes: [],
                events: [],
                links: [],
                status: { code: 1 },
                droppedAttributesCount: 0,
                droppedEventsCount: 0,
                droppedLinksCount: 0,
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildProtobufBody(): Buffer {
  const message = traceRequestType.create(buildTraceRequest());
  return Buffer.from(traceRequestType.encode(message).finish() as Uint8Array);
}

function makeRequest(body: Buffer, headers: Record<string, string>): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers,
    body: new Uint8Array(body),
  });
}

/** Reads the body then parses it, returning the names of the spans found. */
async function spanNamesFrom(req: Request): Promise<string[]> {
  const body = await readOtlpBody(req);
  const parsed = parseOtlpTraces(body, "application/x-protobuf");
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error}`);
  return (parsed.request.resourceSpans ?? [])
    .flatMap((rs) => rs.scopeSpans ?? [])
    .flatMap((ss) => ss.spans ?? [])
    .map((span) => span.name);
}

const protobuf = buildProtobufBody();
const oversize = Buffer.alloc(OTLP_MAX_BODY_BYTES + 1024 * 1024, 0);

describe("readOtlpBody magic-byte detection", () => {
  describe("given a zstd-compressed trace export", () => {
    const body = zstdCompressSync(protobuf);

    describe("when there is no Content-Encoding header", () => {
      /** @scenario A zstd body sent without a Content-Encoding header is accepted */
      it("reads the span", async () => {
        const names = await spanNamesFrom(makeRequest(body, {}));

        expect(names).toEqual(["magic-span"]);
      });
    });

    describe("when Content-Encoding is identity", () => {
      /** @scenario A zstd body sent as identity is accepted */
      it("reads the span", async () => {
        const names = await spanNamesFrom(
          makeRequest(body, { "content-encoding": "identity" }),
        );

        expect(names).toEqual(["magic-span"]);
      });
    });

    describe("when Content-Encoding is zstd", () => {
      /** @scenario A zstd body declared as zstd is accepted */
      it("reads the span", async () => {
        const names = await spanNamesFrom(
          makeRequest(body, { "content-encoding": "zstd" }),
        );

        expect(names).toEqual(["magic-span"]);
      });
    });
  });

  describe("given a gzip-compressed trace export", () => {
    const body = gzipSync(protobuf);

    describe.each([
      ["deflate", "a supported but wrong"],
      ["br", "a supported but wrong"],
      ["snappy", "an unsupported"],
    ])("when Content-Encoding is %s (%s encoding)", (encoding) => {
      /** @scenario A gzip body under a wrong or unsupported encoding is accepted */
      it("reads the span", async () => {
        const names = await spanNamesFrom(
          makeRequest(body, { "content-encoding": encoding }),
        );

        expect(names).toEqual(["magic-span"]);
      });
    });
  });

  describe("given a plain protobuf body with no compression signature", () => {
    describe("when there is no Content-Encoding header", () => {
      /** @scenario A body with no compression signature is handled as before */
      it("reads the span unchanged", async () => {
        const names = await spanNamesFrom(makeRequest(protobuf, {}));

        expect(names).toEqual(["magic-span"]);
      });
    });

    describe("when Content-Encoding is unsupported", () => {
      /** @scenario A body with no compression signature is handled as before */
      it("refuses it as an unsupported encoding", async () => {
        const req = makeRequest(protobuf, { "content-encoding": "snappy" });

        await expect(readOtlpBody(req)).rejects.toBeInstanceOf(
          OtlpUnsupportedEncodingError,
        );
      });
    });
  });

  describe("given a small compressed body that expands past the byte limit", () => {
    describe.each([
      [
        "gzip",
        "gzip (header)",
        () => gzipSync(oversize),
        { "content-encoding": "gzip" },
      ],
      [
        "deflate",
        "deflate (header)",
        () => deflateSync(oversize),
        { "content-encoding": "deflate" },
      ],
      [
        "br",
        "br (header)",
        () => brotliCompressSync(oversize),
        { "content-encoding": "br" },
      ],
      [
        "zstd",
        "zstd (header)",
        () => zstdCompressSync(oversize),
        { "content-encoding": "zstd" },
      ],
      [
        "zstd",
        "zstd (sniffed, no header)",
        () => zstdCompressSync(oversize),
        {},
      ],
      [
        "gzip",
        "gzip (sniffed, wrong header)",
        () => gzipSync(oversize),
        { "content-encoding": "deflate" },
      ],
    ] as Array<
      [string, string, () => Buffer, Record<string, string>]
    >)("when the body is %s, read as %s", (_codec, _label, compress, headers) => {
      /** @scenario A body that expands past the limit is refused under every decoder */
      it("refuses it as too large with a 413", async () => {
        const req = makeRequest(compress(), headers);

        await expect(readOtlpBody(req)).rejects.toMatchObject({
          code: "ERR_PAYLOAD_TOO_LARGE",
          httpStatus: 413,
        });
      });

      it("raises the too-large error type", async () => {
        const req = makeRequest(compress(), headers);

        await expect(readOtlpBody(req)).rejects.toBeInstanceOf(
          OtlpBodyTooLargeError,
        );
      });
    });
  });
});
