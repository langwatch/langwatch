import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { createTenantId } from "../storage";
import { MAX_BLOB_BYTES } from "../blobConstants";
import {
  assertPayloadWithinCap,
  decodeJobEnvelope,
  encodeJobEnvelope,
  PayloadTooLargeError,
  readEnvelopeLease,
  readEnvelopeRetirement,
  readJobPayloadBytes,
  readJobRoutingMeta,
} from "../jobEnvelope";
import { TieredBlobStore } from "../tieredBlobStore";
import { InMemoryJobBlobStore, InMemoryObjectStore } from "./blob-test-doubles";

describe("jobEnvelope", () => {
  // The GROUP_QUEUE_ENVELOPE_WRITES_ENABLED flag that let encodeJobEnvelope
  // fall back to writing un-enveloped bare JSON (and decodeJobEnvelope back to
  // reading it) is retired: the flag is gone from jobEnvelope.ts, and
  // decodeJobEnvelope now unconditionally requires a version-2 envelope. The
  // "given envelope writes are not enabled" and "given a legacy bare-JSON
  // value" describe blocks tested that retired dual-format compatibility path
  // and are dropped rather than forced.

  describe("given a payload over the compression threshold", () => {
    const largePayload = {
      __pipelineName: "traces",
      __jobType: "command",
      __jobName: "recordSpan",
      __context: { traceId: "t1", projectId: "p1" },
      // Kept under INLINE_CEILING_BYTES (4096): large enough to cross
      // COMPRESSION_THRESHOLD_BYTES (1024) and compress, small enough to stay
      // inline rather than requiring tieredBlobs + projectId to offload.
      span: { attributes: "x".repeat(2048) },
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
        // Wire format is unconditionally the v2 envelope now (GQ1's ambient
        // env-flagged legacy format is retired — see the note above).
        expect(encoded.startsWith("GQ2|")).toBe(true);
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

  // The GQ1-era single-tier `blobs` offload param on encodeJobEnvelope (an
  // "e":"ref" wire header, and a blobId-keyed retirement) was retired along
  // with GQ1: encodeJobEnvelope now requires `tieredBlobs` + `projectId` for
  // any payload over INLINE_CEILING_BYTES and throws without them, and the
  // lease-based retirement model those scenarios exercise lives on in the
  // "given a tiered blob store and a projectId (GQ2)" describe block below,
  // plus job-envelope-attempt.unit.test.ts and blobLeases.unit.test.ts.

  describe("given an inline-body envelope", () => {
    it("carries no retirement lease", async () => {
      const encoded = await encodeJobEnvelope({
        jobData: { __jobName: "tiny", value: 1 },
      });
      expect(readEnvelopeRetirement(encoded).lease).toBeNull();
      expect(readEnvelopeRetirement('{"legacy":true}').lease).toBeNull();
      expect(readEnvelopeRetirement("GQ1|nonsense").lease).toBeNull();
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
      // Over INLINE_CEILING_BYTES, so it offloads — encodeJobEnvelope now
      // requires tieredBlobs + projectId for any offloaded payload (the GQ1
      // no-store inline fallback this test originally exercised is retired).
      const redisBlobs = new InMemoryJobBlobStore();
      const tieredBlobs = new TieredBlobStore({
        redisBlobs,
        objectStoreFor: () => new InMemoryObjectStore(),
        resolveDestination: async () => ({ kind: "s3", bucket: "test-bucket" }),
        s3ThresholdBytes: 256 * 1024,
      });
      const payload = { __jobName: "uni", text: "héllo 🌍 ".repeat(500) };
      const encoded = await encodeJobEnvelope({
        jobData: payload,
        tieredBlobs,
        projectId: createTenantId("project-abc"),
      });
      expect(
        await decodeJobEnvelope({ value: encoded, tieredBlobs }),
      ).toEqual(payload);
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

    // ADR-066 pillar 2: what a coalesced batch will weigh cannot be read off the
    // stored value once a body is compressed or offloaded, so the encoder
    // records it in the header and the drain's byte budget reads it there.
    describe("when the recorded payload size is read back", () => {
      it("reports the pre-offload payload size for an offloaded body", async () => {
        const { tieredBlobs } = makeTiered();
        const jobData = {
          __jobName: "spanReceived",
          bulk: "z".repeat(64 * 1024),
        };

        const encoded = await encodeJobEnvelope({
          jobData,
          tieredBlobs,
          projectId: PROJECT,
        });

        // The stored value is a small reference; the payload is not.
        expect(Buffer.byteLength(encoded)).toBeLessThan(1024);
        expect(readJobPayloadBytes(encoded)).toBeGreaterThan(64 * 1024);
      });

      it("reports the uncompressed payload size for a compressed inline body", async () => {
        const { tieredBlobs } = makeTiered();
        // Over the compression threshold, under the inline ceiling: stays in the
        // envelope, but stored far smaller than it will be in a worker's hands.
        const jobData = { __jobName: "tiny", bulk: "z".repeat(3 * 1024) };

        const encoded = await encodeJobEnvelope({
          jobData,
          tieredBlobs,
          projectId: PROJECT,
        });

        expect(readJobPayloadBytes(encoded)).toBeGreaterThan(
          Buffer.byteLength(encoded),
        );
        expect(readJobPayloadBytes(encoded)).toBeGreaterThan(3 * 1024);
      });

      it("falls back to the stored length for legacy bare JSON", () => {
        const value = JSON.stringify({ hello: "world" });

        expect(readJobPayloadBytes(value)).toBe(Buffer.byteLength(value));
      });

      it("falls back to the stored length for a corrupt value", () => {
        expect(readJobPayloadBytes("GQ2|not-a-length|{}")).toBe(19);
      });

      // Old workers keep staging pre-`s` envelopes for the length of a rolling
      // deploy. For those, the stored length is honest only when the body is
      // inline and uncompressed; anything else is a fraction of the payload
      // with nothing in the value saying by how much.
      describe("when the envelope predates the recorded size", () => {
        /** Strips `s` back out of an encoded envelope, leaving the rest intact. */
        const withoutRecordedSize = (value: string): string => {
          const buf = Buffer.from(value, "utf8");
          const barIdx = buf.indexOf(0x7c, 4); // "|" after the prefix
          const headerLen = Number(buf.subarray(4, barIdx).toString("utf8"));
          const header = JSON.parse(
            buf.subarray(barIdx + 1, barIdx + 1 + headerLen).toString("utf8"),
          ) as Record<string, unknown>;
          const body = buf.subarray(barIdx + 1 + headerLen).toString("utf8");
          delete header.s;
          const json = JSON.stringify(header);
          return `${value.slice(0, 4)}${Buffer.byteLength(json)}|${json}${body}`;
        };

        it("costs the payload cap for an offloaded body", async () => {
          const { tieredBlobs } = makeTiered();
          const encoded = await encodeJobEnvelope({
            jobData: { __jobName: "spanReceived", bulk: "z".repeat(64 * 1024) },
            tieredBlobs,
            projectId: PROJECT,
          });

          const legacy = withoutRecordedSize(encoded);

          // A stored-length reading would call a 64 KiB payload ~200 bytes.
          expect(Buffer.byteLength(legacy)).toBeLessThan(1024);
          expect(readJobPayloadBytes(legacy)).toBe(MAX_BLOB_BYTES);
        });

        it("costs the payload cap for a compressed inline body", async () => {
          const { tieredBlobs } = makeTiered();
          const encoded = await encodeJobEnvelope({
            jobData: { __jobName: "tiny", bulk: "z".repeat(3 * 1024) },
            tieredBlobs,
            projectId: PROJECT,
          });

          const legacy = withoutRecordedSize(encoded);

          expect(readJobPayloadBytes(legacy)).toBe(MAX_BLOB_BYTES);
        });

        // A recorded size that is not a byte count must not be able to talk the
        // budget down. `1e999` is the one that matters: it is valid JSON, parses
        // to Infinity, and would reach the Lua drain as an unparseable ARGV.
        // Written as raw header text because JSON.stringify cannot emit these.
        const SIZES = [
          "1e999",
          "9007199254740992",
          "0.1",
          "-1",
          '"4096"',
          "null",
        ];

        it.each(
          SIZES,
        )("ignores a recorded size of %s, costing the cap", (s) => {
          const header = `{"v":2,"e":"redis","s":${s}}`;
          const value = `GQ2|${Buffer.byteLength(header)}|${header}`;

          expect(readJobPayloadBytes(value)).toBe(MAX_BLOB_BYTES);
        });

        it("keeps the stored length for a plain inline body", async () => {
          const { tieredBlobs } = makeTiered();
          const encoded = await encodeJobEnvelope({
            jobData: { __jobName: "tiny", value: 1 },
            tieredBlobs,
            projectId: PROJECT,
          });

          const legacy = withoutRecordedSize(encoded);

          expect(readJobPayloadBytes(legacy)).toBe(Buffer.byteLength(legacy));
        });
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
        expect(readEnvelopeLease(encoded)).toBeNull();
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
        expect(readEnvelopeLease(encoded)?.ref).toMatchObject({
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
        expect(readEnvelopeLease(encoded)?.ref.tier).toBe("s3");
        expect(objectStore.store.size).toBe(1);
        expect(
          await decodeJobEnvelope({ value: encoded, tieredBlobs }),
        ).toEqual(big);
      });

      /** @scenario "Provider migration does not change the durable queue reference format" */
      it("keeps the durable reference on the existing GQ2 wire shape", async () => {
        const { tieredBlobs } = makeTiered(8);

        const encoded = await encodeJobEnvelope({
          jobData: big,
          tieredBlobs,
          projectId: PROJECT,
        });
        const lease = readEnvelopeLease(encoded);

        expect(encoded.startsWith("GQ2|")).toBe(true);
        expect(lease?.ref).toEqual({
          tier: "s3",
          projectId: PROJECT,
          hash: expect.any(String),
        });
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

      it("stores one copy for byte-identical payloads with distinct lease identities", async () => {
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
        // One shared blob ref, but a distinct per-stage lease identity each time.
        expect(readEnvelopeLease(e1)?.ref).toEqual(readEnvelopeLease(e2)?.ref);
        expect(readEnvelopeLease(e1)?.holderId).not.toBe(
          readEnvelopeLease(e2)?.holderId,
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

        // Same user payload, two distinct fan-out subscribers over the same event.
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

        // The two envelopes are different (different headers / lease identities)
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
