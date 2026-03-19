import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { readBody } from "./decompressBody";

describe("readBody", () => {
  const payload = JSON.stringify({ hello: "world" });

  describe("when no Content-Encoding header is present", () => {
    it("returns the raw body unchanged", async () => {
      const req = new NextRequest("http://localhost/api/otel/v1/traces", {
        method: "POST",
        body: payload,
      });

      const result = await readBody(req);

      expect(Buffer.from(result).toString("utf-8")).toBe(payload);
    });
  });

  describe("when Content-Encoding is identity", () => {
    it("returns the raw body unchanged", async () => {
      const req = new NextRequest("http://localhost/api/otel/v1/traces", {
        method: "POST",
        body: payload,
        headers: { "Content-Encoding": "identity" },
      });

      const result = await readBody(req);

      expect(Buffer.from(result).toString("utf-8")).toBe(payload);
    });
  });

  describe("when Content-Encoding is gzip", () => {
    it("decompresses the body", async () => {
      const compressed = new Uint8Array(gzipSync(Buffer.from(payload)));

      const req = new NextRequest("http://localhost/api/otel/v1/traces", {
        method: "POST",
        body: compressed,
        headers: { "Content-Encoding": "gzip" },
      });

      const result = await readBody(req);

      expect(Buffer.from(result).toString("utf-8")).toBe(payload);
    });

    it("preserves binary protobuf data after decompression", async () => {
      const binaryData = new Uint8Array([0x0a, 0x12, 0x08, 0x00, 0xff, 0xfe]);
      const compressed = new Uint8Array(gzipSync(Buffer.from(binaryData)));

      const req = new NextRequest("http://localhost/api/otel/v1/traces", {
        method: "POST",
        body: compressed,
        headers: { "Content-Encoding": "gzip" },
      });

      const result = await readBody(req);

      expect(new Uint8Array(result)).toEqual(binaryData);
    });
  });

  describe("when Content-Encoding is deflate", () => {
    it("decompresses the body", async () => {
      const compressed = new Uint8Array(deflateSync(Buffer.from(payload)));

      const req = new NextRequest("http://localhost/api/otel/v1/traces", {
        method: "POST",
        body: compressed,
        headers: { "Content-Encoding": "deflate" },
      });

      const result = await readBody(req);

      expect(Buffer.from(result).toString("utf-8")).toBe(payload);
    });
  });

  describe("when Content-Encoding is br", () => {
    it("decompresses the body", async () => {
      const compressed = new Uint8Array(brotliCompressSync(Buffer.from(payload)));

      const req = new NextRequest("http://localhost/api/otel/v1/traces", {
        method: "POST",
        body: compressed,
        headers: { "Content-Encoding": "br" },
      });

      const result = await readBody(req);

      expect(Buffer.from(result).toString("utf-8")).toBe(payload);
    });
  });

  describe("when Content-Encoding is unsupported", () => {
    it("throws an error", async () => {
      const req = new NextRequest("http://localhost/api/otel/v1/traces", {
        method: "POST",
        body: payload,
        headers: { "Content-Encoding": "zstd" },
      });

      await expect(readBody(req)).rejects.toThrow(
        "Unsupported Content-Encoding: zstd",
      );
    });
  });
});
