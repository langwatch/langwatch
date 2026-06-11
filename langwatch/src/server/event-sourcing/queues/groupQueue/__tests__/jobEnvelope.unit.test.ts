import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decodeJobEnvelope,
  encodeJobEnvelope,
  type JobBlobStore,
  readEnvelopeBlobId,
  readJobRoutingMeta,
} from "../jobEnvelope";

class InMemoryBlobStore implements JobBlobStore {
  readonly blobs = new Map<string, Buffer>();

  async put({ id, data }: { id: string; data: Buffer }): Promise<void> {
    this.blobs.set(id, data);
  }

  async get({ id }: { id: string }): Promise<Buffer | null> {
    return this.blobs.get(id) ?? null;
  }

  async delete({ id }: { id: string }): Promise<void> {
    this.blobs.delete(id);
  }
}

describe("jobEnvelope", () => {
  beforeEach(() => {
    process.env.GROUP_QUEUE_ENVELOPE_WRITES_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.GROUP_QUEUE_ENVELOPE_WRITES_ENABLED;
  });

  describe("given envelope writes are not enabled", () => {
    const payload = {
      __pipelineName: "traces",
      __jobType: "command",
      __jobName: "recordSpan",
      bulk: "x".repeat(4096),
    };

    beforeEach(() => {
      delete process.env.GROUP_QUEUE_ENVELOPE_WRITES_ENABLED;
    });

    describe("when encoding", () => {
      it("writes legacy bare JSON that a previous-release JSON.parse reader accepts", async () => {
        const encoded = await encodeJobEnvelope({ jobData: payload });
        expect(encoded.startsWith("GQ1|")).toBe(false);
        expect(JSON.parse(encoded)).toEqual(payload);
      });

      it("still decodes and exposes routing meta through the dual readers", async () => {
        const encoded = await encodeJobEnvelope({ jobData: payload });
        expect(await decodeJobEnvelope({ value: encoded })).toEqual(payload);
        expect(readJobRoutingMeta(encoded)).toEqual({
          pipelineName: "traces",
          jobType: "command",
          jobName: "recordSpan",
        });
      });
    });
  });

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
        const encoded = await encodeJobEnvelope({ jobData: largePayload });
        expect(await decodeJobEnvelope({ value: encoded })).toEqual(
          largePayload,
        );
      });

      it("stores the body gzip-compressed and smaller than the raw JSON", async () => {
        const encoded = await encodeJobEnvelope({ jobData: largePayload });
        expect(encoded.startsWith("GQ1|")).toBe(true);
        expect(encoded).toContain('"e":"gz"');
        expect(encoded.length).toBeLessThan(
          JSON.stringify(largePayload).length,
        );
      });

      it("exposes routing fields from the header without decoding the body", async () => {
        const encoded = await encodeJobEnvelope({ jobData: largePayload });
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
        const encoded = await encodeJobEnvelope({ jobData: smallPayload });
        expect(encoded).toContain('"e":"j"');
        expect(encoded).toContain('"value":1');
      });

      it("round-trips the payload deep-equal", async () => {
        const encoded = await encodeJobEnvelope({ jobData: smallPayload });
        expect(await decodeJobEnvelope({ value: encoded })).toEqual(
          smallPayload,
        );
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
      expect(await decodeJobEnvelope({ value: legacy })).toEqual(
        JSON.parse(legacy),
      );
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
      expect(await encodeJobEnvelope({ jobData: payload })).toContain(
        '"e":"j"',
      );
    });

    it("compresses a payload of 1025 JSON bytes", async () => {
      const payload = payloadOfJsonByteLength(1025);
      expect(Buffer.byteLength(JSON.stringify(payload))).toBe(1025);
      expect(await encodeJobEnvelope({ jobData: payload })).toContain(
        '"e":"gz"',
      );
    });
  });

  describe("given a payload over the blob offload threshold", () => {
    const hugePayload = {
      __pipelineName: "traces",
      __jobType: "command",
      __jobName: "recordSpan",
      bulk: "y".repeat(64 * 1024),
    };

    describe("when a blob store is provided", () => {
      it("offloads the body to the store and leaves a tiny ref envelope", async () => {
        const blobs = new InMemoryBlobStore();
        const encoded = await encodeJobEnvelope({
          jobData: hugePayload,
          blobs,
        });
        expect(encoded).toContain('"e":"ref"');
        expect(encoded.length).toBeLessThan(256);
        expect(blobs.blobs.size).toBe(1);
        expect(readJobRoutingMeta(encoded)).toEqual({
          pipelineName: "traces",
          jobType: "command",
          jobName: "recordSpan",
        });
      });

      it("round-trips the payload through the store", async () => {
        const blobs = new InMemoryBlobStore();
        const encoded = await encodeJobEnvelope({
          jobData: hugePayload,
          blobs,
        });
        expect(await decodeJobEnvelope({ value: encoded, blobs })).toEqual(
          hugePayload,
        );
      });

      it("exposes the blob id for completion-time deletion", async () => {
        const blobs = new InMemoryBlobStore();
        const encoded = await encodeJobEnvelope({
          jobData: hugePayload,
          blobs,
        });
        const blobId = readEnvelopeBlobId(encoded);
        expect(blobId).not.toBeNull();
        expect(blobs.blobs.has(blobId!)).toBe(true);
      });

      it("rejects decode when the blob is missing or no store is given", async () => {
        const blobs = new InMemoryBlobStore();
        const encoded = await encodeJobEnvelope({
          jobData: hugePayload,
          blobs,
        });
        await expect(decodeJobEnvelope({ value: encoded })).rejects.toThrow(
          /blob store/,
        );
        blobs.blobs.clear();
        await expect(
          decodeJobEnvelope({ value: encoded, blobs }),
        ).rejects.toThrow(/missing/);
      });
    });

    describe("when no blob store is provided", () => {
      it("falls back to inline gzip+base64", async () => {
        const encoded = await encodeJobEnvelope({ jobData: hugePayload });
        expect(encoded).toContain('"e":"gz"');
        expect(await decodeJobEnvelope({ value: encoded })).toEqual(
          hugePayload,
        );
      });
    });
  });

  describe("given an inline-body envelope", () => {
    it("readEnvelopeBlobId returns null", async () => {
      const encoded = await encodeJobEnvelope({
        jobData: { __jobName: "tiny", value: 1 },
      });
      expect(readEnvelopeBlobId(encoded)).toBeNull();
      expect(readEnvelopeBlobId('{"legacy":true}')).toBeNull();
      expect(readEnvelopeBlobId("GQ1|nonsense")).toBeNull();
    });
  });

  describe("given a large incompressible payload", () => {
    it("keeps the body raw when gzip+base64 would grow it", async () => {
      // Simulates inline base64-ish data below the S3 spool threshold:
      // high-entropy strings gain ~37% through gzip+base64.
      const bytes = Buffer.alloc(8192);
      let state = 0x9e3779b9;
      for (let i = 0; i < bytes.length; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        bytes[i] = state & 0xff;
      }
      const payload = { __jobName: "media", blob: bytes.toString("base64") };
      const json = JSON.stringify(payload);

      const encoded = await encodeJobEnvelope({ jobData: payload });
      expect(encoded).toContain('"e":"j"');
      expect(encoded.length).toBeLessThan(json.length + 64);
      expect(await decodeJobEnvelope({ value: encoded })).toEqual(payload);
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
      const encoded = await encodeJobEnvelope({ jobData: payload });
      expect(readJobRoutingMeta(encoded)).toEqual({
        pipelineName: "traçes-π",
        jobType: "événement",
        jobName: "spanReçu",
      });
      expect(await decodeJobEnvelope({ value: encoded })).toEqual(payload);
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
      const decoded = await decodeJobEnvelope({
        value: await encodeJobEnvelope({ jobData: original }),
      });
      const { __context: _c, __attempt: _a, ...stripped } = decoded;
      const reEncoded = await encodeJobEnvelope({
        jobData: {
          ...stripped,
          __context: { traceId: "t1" },
          __attempt: 2,
        },
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
      await expect(
        decodeJobEnvelope({ value: "GQ1|nonsense" }),
      ).rejects.toThrow();
      await expect(decodeJobEnvelope({ value: "not json" })).rejects.toThrow();
      await expect(decodeJobEnvelope({ value: "GQ1|5" })).rejects.toThrow();
      await expect(decodeJobEnvelope({ value: "GQ1|0|{}" })).rejects.toThrow();
      await expect(
        decodeJobEnvelope({ value: "GQ1|8|{not:js}body" }),
      ).rejects.toThrow();
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
      const encoded = await encodeJobEnvelope({ jobData: payload });
      expect(await decodeJobEnvelope({ value: encoded })).toEqual(payload);
    });
  });
});
