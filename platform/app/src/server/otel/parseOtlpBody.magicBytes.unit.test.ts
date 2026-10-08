/**
 * How the shared OTLP body reader picks a decompressor: the body's magic bytes
 * (gzip, zstd) decide first, `Content-Encoding` second. Every decoder is
 * bounded by OTLP_MAX_BODY_BYTES.
 *
 * Spec: specs/otlp/otlp-body-magic-bytes.feature
 */

import { gzipSync, zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  buildProtobufBody,
  buildTraceRequest,
  makeRequest,
} from "./__tests__/fixtures/otlpTraceBody";
import {
  OTLP_MAX_BODY_BYTES,
  parseOtlpTraces,
  readOtlpBody,
} from "./parseOtlpBody";

async function spanNamesFrom(req: Request): Promise<string[]> {
  const body = await readOtlpBody(req);
  const parsed = parseOtlpTraces(body, "application/x-protobuf");
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error}`);
  return (parsed.request.resourceSpans ?? [])
    .flatMap((rs) => rs.scopeSpans ?? [])
    .flatMap((ss) => ss.spans ?? [])
    .map((span) => span.name);
}

const protobuf = Buffer.from(buildProtobufBody(buildTraceRequest()));
const oversize = Buffer.alloc(OTLP_MAX_BODY_BYTES + 1024 * 1024, 0);

describe("readOtlpBody magic-byte detection", () => {
  describe("given a zstd-compressed trace export", () => {
    const body = zstdCompressSync(protobuf);

    describe("when there is no Content-Encoding header", () => {
      /** @scenario A zstd body sent without a Content-Encoding header is accepted */
      it("reads the span", async () => {
        const names = await spanNamesFrom(makeRequest(body, {}));

        expect(names).toEqual(["test-span"]);
      });
    });

    describe("when Content-Encoding is identity", () => {
      /** @scenario A zstd body sent as identity is accepted */
      it("reads the span", async () => {
        const names = await spanNamesFrom(
          makeRequest(body, { "content-encoding": "identity" }),
        );

        expect(names).toEqual(["test-span"]);
      });
    });

    describe("when Content-Encoding is zstd", () => {
      /** @scenario A zstd body declared as zstd is accepted */
      it("reads the span", async () => {
        const names = await spanNamesFrom(
          makeRequest(body, { "content-encoding": "zstd" }),
        );

        expect(names).toEqual(["test-span"]);
      });
    });

    describe("when Content-Encoding is an unsupported encoding", () => {
      /** @scenario A zstd body under an unsupported encoding is accepted */
      it("reads the span", async () => {
        const names = await spanNamesFrom(
          makeRequest(body, { "content-encoding": "snappy" }),
        );

        expect(names).toEqual(["test-span"]);
      });
    });
  });

  describe("given a gzip-compressed trace export", () => {
    const body = gzipSync(protobuf);

    describe.each([
      "deflate",
      "br",
      "snappy",
    ])("when Content-Encoding is %s", (encoding) => {
      /** @scenario A gzip body under a wrong or unsupported encoding is accepted */
      it("reads the span", async () => {
        const names = await spanNamesFrom(
          makeRequest(body, { "content-encoding": encoding }),
        );

        expect(names).toEqual(["test-span"]);
      });
    });
  });

  describe("given a plain protobuf body with no compression signature", () => {
    describe("when there is no Content-Encoding header", () => {
      /** @scenario A plain body with no compression is read as before */
      it("reads the span unchanged", async () => {
        const names = await spanNamesFrom(makeRequest(protobuf, {}));

        expect(names).toEqual(["test-span"]);
      });
    });
  });

  describe("given a small compressed body that expands past the byte limit", () => {
    describe.each([
      [
        "zstd (header)",
        () => zstdCompressSync(oversize),
        { "content-encoding": "zstd" },
      ],
      ["zstd (sniffed, no header)", () => zstdCompressSync(oversize), {}],
      [
        "gzip (sniffed, wrong header)",
        () => gzipSync(oversize),
        { "content-encoding": "deflate" },
      ],
    ] as Array<
      [string, () => Buffer, Record<string, string>]
    >)("when the body is %s", (_label, compress, headers) => {
      /** @scenario A body that expands past the limit is refused under every encoding */
      it("refuses it as too large with a 413", async () => {
        await expect(
          readOtlpBody(makeRequest(compress(), headers)),
        ).rejects.toMatchObject({
          code: "ERR_PAYLOAD_TOO_LARGE",
          httpStatus: 413,
        });
      });
    });
  });
});
