import { describe, expect, it } from "vitest";

import {
  decodeJobEnvelope,
  encodeJobEnvelope,
  readJobRoutingMeta,
} from "../jobEnvelope";

describe("jobEnvelope", () => {
  describe("given a payload over the compression threshold", () => {
    const largePayload = {
      __pipelineName: "traces",
      __jobType: "command",
      __jobName: "recordSpan",
      __context: { traceId: "t1", projectId: "p1" },
      span: { attributes: "x".repeat(4096) },
    };

    describe("when encoded and decoded", () => {
      it("round-trips the payload deep-equal", async () => {
        const encoded = await encodeJobEnvelope(largePayload);
        expect(await decodeJobEnvelope(encoded)).toEqual(largePayload);
      });

      it("stores the body gzip-compressed and smaller than the raw JSON", async () => {
        const encoded = await encodeJobEnvelope(largePayload);
        expect(encoded.startsWith("GQ1|")).toBe(true);
        expect(encoded).toContain('"e":"gz"');
        expect(encoded.length).toBeLessThan(
          JSON.stringify(largePayload).length,
        );
      });

      it("exposes routing fields from the header without decoding the body", async () => {
        const encoded = await encodeJobEnvelope(largePayload);
        expect(readJobRoutingMeta(encoded)).toEqual({
          pipelineName: "traces",
          jobType: "command",
          jobName: "recordSpan",
        });
      });
    });
  });

  describe("given a payload under the compression threshold", () => {
    const smallPayload = { __jobName: "tiny", value: 1 };

    describe("when encoded", () => {
      it("keeps the body as raw JSON", async () => {
        const encoded = await encodeJobEnvelope(smallPayload);
        expect(encoded).toContain('"e":"j"');
        expect(encoded).toContain('"value":1');
      });

      it("round-trips the payload deep-equal", async () => {
        const encoded = await encodeJobEnvelope(smallPayload);
        expect(await decodeJobEnvelope(encoded)).toEqual(smallPayload);
      });
    });
  });

  describe("given a legacy bare-JSON value", () => {
    const legacy = JSON.stringify({
      __pipelineName: "traces",
      __jobType: "event",
      __jobName: "spanReceived",
      data: true,
    });

    it("decodes as plain JSON", async () => {
      expect(await decodeJobEnvelope(legacy)).toEqual(JSON.parse(legacy));
    });

    it("reads routing fields via full parse", () => {
      expect(readJobRoutingMeta(legacy)).toEqual({
        pipelineName: "traces",
        jobType: "event",
        jobName: "spanReceived",
      });
    });
  });

  describe("given a payload at the compression threshold boundary", () => {
    function payloadOfJsonByteLength(target: number): Record<string, unknown> {
      const skeleton = JSON.stringify({ pad: "" });
      return { pad: "x".repeat(target - Buffer.byteLength(skeleton)) };
    }

    it("keeps a payload of exactly 1024 JSON bytes raw", async () => {
      const payload = payloadOfJsonByteLength(1024);
      expect(Buffer.byteLength(JSON.stringify(payload))).toBe(1024);
      expect(await encodeJobEnvelope(payload)).toContain('"e":"j"');
    });

    it("compresses a payload of 1025 JSON bytes", async () => {
      const payload = payloadOfJsonByteLength(1025);
      expect(Buffer.byteLength(JSON.stringify(payload))).toBe(1025);
      expect(await encodeJobEnvelope(payload)).toContain('"e":"gz"');
    });
  });

  describe("given routing fields containing non-ASCII characters", () => {
    it("round-trips and exposes routing meta with a byte-accurate header length", async () => {
      const payload = {
        __pipelineName: "traçes-π",
        __jobType: "événement",
        __jobName: "spanReçu",
        bulk: "x".repeat(2048),
      };
      const encoded = await encodeJobEnvelope(payload);
      expect(readJobRoutingMeta(encoded)).toEqual({
        pipelineName: "traçes-π",
        jobType: "événement",
        jobName: "spanReçu",
      });
      expect(await decodeJobEnvelope(encoded)).toEqual(payload);
    });
  });

  describe("given a payload that went through internal-field stripping", () => {
    it("keeps routing fields in the header after a strip and re-encode cycle", async () => {
      // Retry/exhaust re-staging spreads the stripped payload back into a new
      // envelope; routing fields must survive or pause checks stop matching.
      const original = {
        __pipelineName: "traces",
        __jobType: "command",
        __jobName: "recordSpan",
        __context: { traceId: "t1" },
        __attempt: 1,
        data: true,
      };
      const decoded = await decodeJobEnvelope(
        await encodeJobEnvelope(original),
      );
      const { __context: _c, __attempt: _a, ...stripped } = decoded;
      const reEncoded = await encodeJobEnvelope({
        ...stripped,
        __context: { traceId: "t1" },
        __attempt: 2,
      });
      expect(readJobRoutingMeta(reEncoded)).toEqual({
        pipelineName: "traces",
        jobType: "command",
        jobName: "recordSpan",
      });
    });
  });

  describe("given a corrupt value", () => {
    it("decodeJobEnvelope rejects", async () => {
      await expect(decodeJobEnvelope("GQ1|nonsense")).rejects.toThrow();
      await expect(decodeJobEnvelope("not json")).rejects.toThrow();
      await expect(decodeJobEnvelope("GQ1|5")).rejects.toThrow();
      await expect(decodeJobEnvelope("GQ1|0|{}")).rejects.toThrow();
      await expect(decodeJobEnvelope("GQ1|8|{not:js}body")).rejects.toThrow();
    });

    it("readJobRoutingMeta returns nulls instead of throwing", () => {
      expect(readJobRoutingMeta("GQ1|nonsense")).toEqual({
        pipelineName: null,
        jobType: null,
        jobName: null,
      });
      expect(readJobRoutingMeta("not json")).toEqual({
        pipelineName: null,
        jobType: null,
        jobName: null,
      });
    });
  });

  describe("given a payload containing multibyte characters", () => {
    it("round-trips unicode through compression intact", async () => {
      const payload = { __jobName: "uni", text: "héllo 🌍 ".repeat(500) };
      const encoded = await encodeJobEnvelope(payload);
      expect(await decodeJobEnvelope(encoded)).toEqual(payload);
    });
  });
});
