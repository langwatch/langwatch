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
        expect(encoded.length).toBeLessThan(JSON.stringify(largePayload).length);
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

  describe("given a corrupt value", () => {
    it("decodeJobEnvelope rejects", async () => {
      await expect(decodeJobEnvelope("GQ1|nonsense")).rejects.toThrow();
      await expect(decodeJobEnvelope("not json")).rejects.toThrow();
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
