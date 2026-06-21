import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import { MAX_BLOB_BYTES } from "../blobConstants";
import {
  assertPayloadWithinCap,
  decodeJobEnvelope,
  encodeJobEnvelope,
  PayloadTooLargeError,
  readEnvelopeBlobId,
  readEnvelopeHold,
  readJobRoutingMeta,
} from "../jobEnvelope";
import { TieredBlobStore } from "../tieredBlobStore";
import { InMemoryJobBlobStore, InMemoryObjectStore } from "./blobTestDoubles";

describe("jobEnvelope", () => {
  beforeEach(() => {
    vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("given envelope writes are not enabled", () => {
    const payload = {
      __pipelineName: "traces",
      __jobType: "command",
      __jobName: "recordSpan",
      bulk: "x".repeat(4096),
    };

    beforeEach(() => {
      // Set "false" rather than unset: under the vmThreads pool process.env is
      // shared and aggressively recycled, and vi.stubEnv(key, undefined) clears
      // it via the metaEnv proxy's *delete* path (no deleteProperty trap — it
      // only works by defaulting through to process.env), which races the
      // outer "true" stub. Writing a value goes through the proxy set trap,
      // which reliably forwards. Any non-"true" value exercises the same
      // envelopeWritesEnabled() === false branch.
      vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "false");
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
        const blobs = new InMemoryJobBlobStore();
        const encoded = await encodeJobEnvelope({
          jobData: hugePayload,
          blobs,
        });
        expect(encoded).toContain('"e":"ref"');
        expect(encoded.length).toBeLessThan(256);
        expect(blobs.store.size).toBe(1);
        expect(readJobRoutingMeta(encoded)).toEqual({
          pipelineName: "traces",
          jobType: "command",
          jobName: "recordSpan",
        });
      });

      it("round-trips the payload through the store", async () => {
        const blobs = new InMemoryJobBlobStore();
        const encoded = await encodeJobEnvelope({
          jobData: hugePayload,
          blobs,
        });
        expect(await decodeJobEnvelope({ value: encoded, blobs })).toEqual(
          hugePayload,
        );
      });

      it("exposes the blob id for completion-time deletion", async () => {
        const blobs = new InMemoryJobBlobStore();
        const encoded = await encodeJobEnvelope({
          jobData: hugePayload,
          blobs,
        });
        const blobId = readEnvelopeBlobId(encoded);
        expect(blobId).not.toBeNull();
        expect(blobs.store.has(blobId!)).toBe(true);
      });

      it("rejects decode when the blob is missing or no store is given", async () => {
        const blobs = new InMemoryJobBlobStore();
        const encoded = await encodeJobEnvelope({
          jobData: hugePayload,
          blobs,
        });
        await expect(decodeJobEnvelope({ value: encoded })).rejects.toThrow(
          /blob store/,
        );
        blobs.store.clear();
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

  describe("given the payload-size ceiling", () => {
    describe("when the payload is at the ceiling", () => {
      it("accepts it", () => {
        expect(() => assertPayloadWithinCap(MAX_BLOB_BYTES)).not.toThrow();
      });
    });

    describe("when the payload is over the ceiling", () => {
      it("rejects it with PayloadTooLargeError", () => {
        expect(() => assertPayloadWithinCap(MAX_BLOB_BYTES + 1)).toThrow(
          PayloadTooLargeError,
        );
      });
    });
  });

  describe("given a tiered blob store and a projectId (GQ2)", () => {
    const PROJECT = createTenantId("project-abc");

    function makeTiered(s3ThresholdBytes = 256 * 1024) {
      const redisBlobs = new InMemoryJobBlobStore();
      const objectStore = new InMemoryObjectStore();
      const tieredBlobs = new TieredBlobStore({
        redisBlobs,
        objectStoreFor: () => objectStore,
        resolveDestination: async () => ({ kind: "s3", bucket: "test-bucket" }),
        s3ThresholdBytes,
      });
      return { tieredBlobs, redisBlobs, objectStore };
    }

    describe("when a blob decompresses past the ceiling", () => {
      it("rejects it rather than OOMing (zip-bomb guard)", async () => {
        const { tieredBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: { __jobName: "x", bulk: "z".repeat(8 * 1024) },
          tieredBlobs,
          projectId: PROJECT,
        });
        // Valid JSON that inflates past MAX_BLOB_BYTES: without the gunzip cap,
        // decode would SUCCEED (valid JSON), so dropping the cap fails this test
        // instead of false-passing on an unrelated JSON-parse error.
        const oversizedValidJson = `"${"z".repeat(MAX_BLOB_BYTES + 1)}"`;
        const bombStore = {
          get: async () => gzipSync(Buffer.from(oversizedValidJson, "utf8")),
        } as unknown as TieredBlobStore;

        await expect(
          decodeJobEnvelope({ value: encoded, tieredBlobs: bombStore }),
        ).rejects.toThrow();
      });
    });

    describe("when a small payload is encoded", () => {
      it("keeps it inline under a GQ2 prefix and round-trips", async () => {
        const { tieredBlobs } = makeTiered();
        const payload = { __jobName: "tiny", value: 1 };

        const encoded = await encodeJobEnvelope({
          jobData: payload,
          tieredBlobs,
          projectId: PROJECT,
        });

        expect(encoded.startsWith("GQ2|")).toBe(true);
        expect(readEnvelopeHold(encoded)).toBeNull();
        expect(
          await decodeJobEnvelope({ value: encoded, tieredBlobs }),
        ).toEqual(payload);
      });
    });

    describe("when a payload over the inline ceiling is encoded", () => {
      const big = {
        __pipelineName: "traces",
        __jobType: "event",
        __jobName: "spanReceived",
        bulk: "z".repeat(8 * 1024),
      };

      it("offloads to the redis tier as a content-addressed ref and round-trips", async () => {
        const { tieredBlobs, redisBlobs } = makeTiered();

        const encoded = await encodeJobEnvelope({
          jobData: big,
          tieredBlobs,
          projectId: PROJECT,
        });

        expect(encoded).toContain('"e":"redis"');
        expect(readEnvelopeHold(encoded)?.ref).toMatchObject({
          tier: "redis",
          projectId: PROJECT,
        });
        expect(redisBlobs.store.size).toBe(1);
        expect(
          await decodeJobEnvelope({ value: encoded, tieredBlobs }),
        ).toEqual(big);
      });

      it("offloads to the s3 tier when the stored bytes exceed the s3 threshold", async () => {
        const { tieredBlobs, objectStore } = makeTiered(8);

        const encoded = await encodeJobEnvelope({
          jobData: big,
          tieredBlobs,
          projectId: PROJECT,
        });

        expect(encoded).toContain('"e":"s3"');
        expect(readEnvelopeHold(encoded)?.ref.tier).toBe("s3");
        expect(objectStore.store.size).toBe(1);
        expect(
          await decodeJobEnvelope({ value: encoded, tieredBlobs }),
        ).toEqual(big);
      });

      it("exposes routing meta from the header without resolving the blob", async () => {
        const { tieredBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: big,
          tieredBlobs,
          projectId: PROJECT,
        });
        expect(readJobRoutingMeta(encoded)).toEqual({
          pipelineName: "traces",
          jobType: "event",
          jobName: "spanReceived",
        });
      });

      it("stores one copy for byte-identical payloads, with distinct hold tokens", async () => {
        const { tieredBlobs, redisBlobs } = makeTiered();

        const e1 = await encodeJobEnvelope({
          jobData: big,
          tieredBlobs,
          projectId: PROJECT,
        });
        const e2 = await encodeJobEnvelope({
          jobData: { ...big },
          tieredBlobs,
          projectId: PROJECT,
        });

        expect(redisBlobs.store.size).toBe(1);
        // One shared blob ref, but a distinct per-stage hold token each time —
        // so N fan-out jobs share one body yet each holds its own reference.
        expect(readEnvelopeHold(e1)?.ref).toEqual(readEnvelopeHold(e2)?.ref);
        expect(readEnvelopeHold(e1)?.token).not.toBe(
          readEnvelopeHold(e2)?.token,
        );
      });

      it("rejects decode when the tiered blob is missing or no store is given", async () => {
        const { tieredBlobs, redisBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: big,
          tieredBlobs,
          projectId: PROJECT,
        });

        await expect(decodeJobEnvelope({ value: encoded })).rejects.toThrow(
          /tiered/,
        );
        redisBlobs.store.clear();
        await expect(
          decodeJobEnvelope({ value: encoded, tieredBlobs }),
        ).rejects.toThrow(/missing/);
      });
    });

    describe("when two envelopes have identical user payloads but different queue machinery", () => {
      it("collapses to ONE stored blob (machinery is lifted into the header, not the hashed body)", async () => {
        const { tieredBlobs, redisBlobs } = makeTiered();
        const payload = { evt: "x".repeat(8 * 1024) }; // > 4 KiB → offloads

        // Same user payload, two distinct fan-out reactors over the same event.
        const v1 = await encodeJobEnvelope({
          jobData: {
            ...payload,
            __pipelineName: "experiment-run",
            __jobType: "fold",
            __jobName: "rollup-by-day",
            __attempt: 1,
            __stagedJobId: "j-1",
          },
          tieredBlobs,
          projectId: PROJECT,
        });
        const v2 = await encodeJobEnvelope({
          jobData: {
            ...payload,
            __pipelineName: "experiment-run",
            __jobType: "map",
            __jobName: "billing-projection",
            __attempt: 3,
            __stagedJobId: "j-2",
          },
          tieredBlobs,
          projectId: PROJECT,
        });

        // The two envelopes are different (different headers / hold tokens)
        // but the underlying blob is a single content-addressed entry.
        expect(v1).not.toBe(v2);
        expect(redisBlobs.store.size).toBe(1);

        // Both decode back to the original jobData shape — machinery comes
        // back from the header.
        const d1 = await decodeJobEnvelope({ value: v1, tieredBlobs });
        const d2 = await decodeJobEnvelope({ value: v2, tieredBlobs });
        expect(d1.__jobName).toBe("rollup-by-day");
        expect(d2.__jobName).toBe("billing-projection");
        expect(d1.__attempt).toBe(1);
        expect(d2.__attempt).toBe(3);
        expect(d1.evt).toBe(payload.evt);
        expect(d2.evt).toBe(payload.evt);
      });
    });

    describe("when an inline-tier GQ2 envelope carries machinery", () => {
      it("round-trips via header.m so downstream code sees the original jobData", async () => {
        const { tieredBlobs } = makeTiered();
        const jobData = {
          evt: "small inline payload",
          __pipelineName: "p",
          __jobType: "t",
          __jobName: "n",
          __attempt: 2,
        };
        const encoded = await encodeJobEnvelope({
          jobData,
          tieredBlobs,
          projectId: PROJECT,
        });

        const decoded = await decodeJobEnvelope({
          value: encoded,
          tieredBlobs,
        });
        expect(decoded).toEqual(jobData);
      });
    });
  });
});
