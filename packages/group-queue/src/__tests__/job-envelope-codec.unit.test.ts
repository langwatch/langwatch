import { describe, expect, it } from "vitest";

import { createTenantId } from "../storage";
import { detectCompression, MSGPACK_MIN_BYTES } from "../bodyCodec";
import { decodeJobEnvelope, encodeJobEnvelope, splitEnvelope } from "../jobEnvelope";
import { TieredBlobStore } from "../tieredBlobStore";
import { InMemoryJobBlobStore, InMemoryObjectStore } from "./blob-test-doubles";

const PROJECT = createTenantId("project-codec");

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

/** Comfortably over MSGPACK_MIN_BYTES, and string-heavy like a real LLM body. */
const bigPayload = () => ({
  __jobName: "record-span",
  __pipelineName: "traces",
  traceId: "trace-1",
  input: { value: "the quick brown fox ".repeat(MSGPACK_MIN_BYTES / 10) },
});

/** Under INLINE_CEILING_BYTES, so it never leaves the envelope. */
const smallPayload = () => ({
  __jobName: "record-span",
  __pipelineName: "traces",
  traceId: "trace-1",
  input: { value: "hello" },
});

describe("jobEnvelope body codecs", () => {
  // The compression/payloadCodec choice is no longer read from
  // GROUP_QUEUE_ZSTD_WRITES_ENABLED / GROUP_QUEUE_MSGPACK_WRITES_ENABLED env
  // vars inside jobEnvelope.ts (there is no process.env read left in that
  // file at all): encodeJobEnvelope now takes `compression` and
  // `payloadCodec` as explicit params, resolved once by the caller via
  // resolveGroupQueuePolicyFromEnv (see policy-env.ts) and passed through.
  // These tests pass the resolved codec explicitly instead of stubbing env.

  /** @scenario Provider migration does not change the durable queue reference format */
  it("Provider migration does not change the durable queue reference format", async () => {
    const { tieredBlobs } = makeTiered(1);
    const encoded = await encodeJobEnvelope({
      jobData: {
        projectId: PROJECT,
        payload: "x".repeat(300 * 1024),
      },
      tieredBlobs,
      projectId: PROJECT,
    });

    const { header } = splitEnvelope(encoded);

    expect(header).toMatchObject({
      v: 2,
      e: "s3",
      ref: {
        tier: "s3",
        projectId: PROJECT,
      },
    });
    expect(Object.keys(header.ref ?? {}).sort()).toEqual(["hash", "projectId", "tier"]);
  });

  describe("given a blob written before the codec change (gzip + JSON)", () => {
    describe("when a reader that supports zstd and msgpack decodes it", () => {
      it("decodes it without a migration", async () => {
        const { tieredBlobs, objectStore, redisBlobs } = makeTiered();
        const jobData = bigPayload();

        // Write with both new-format codecs OFF — byte-for-byte what the
        // currently-deployed encoder produces.
        const encoded = await encodeJobEnvelope({
          jobData,
          tieredBlobs,
          projectId: PROJECT,
        });

        const stored = [...redisBlobs.store.values(), ...objectStore.store.values()];
        expect(stored).toHaveLength(1);
        expect(detectCompression(stored[0]!)).toBe("gzip");

        // Now read it on a pod that has the new codecs enabled (reading is
        // codec-agnostic — the decoder detects from the stored bytes).
        expect(await decodeJobEnvelope({ value: encoded, tieredBlobs })).toEqual(jobData);
      });
    });
  });

  describe("given zstd writes are enabled", () => {
    it("compresses the blob with zstd", async () => {
      const { tieredBlobs, objectStore, redisBlobs } = makeTiered();

      await encodeJobEnvelope({
        jobData: bigPayload(),
        tieredBlobs,
        projectId: PROJECT,
        compression: "zstd",
      });

      const stored = [...redisBlobs.store.values(), ...objectStore.store.values()];
      expect(detectCompression(stored[0]!)).toBe("zstd");
    });

    it("round-trips the payload", async () => {
      const { tieredBlobs } = makeTiered();
      const jobData = bigPayload();

      const encoded = await encodeJobEnvelope({
        jobData,
        tieredBlobs,
        projectId: PROJECT,
        compression: "zstd",
      });

      expect(await decodeJobEnvelope({ value: encoded, tieredBlobs })).toEqual(jobData);
    });

    it("round-trips multibyte characters", async () => {
      const { tieredBlobs } = makeTiered();
      const jobData = {
        __jobName: "x",
        text: "日本語テキスト 🎉 ".repeat(MSGPACK_MIN_BYTES / 10),
      };

      const encoded = await encodeJobEnvelope({
        jobData,
        tieredBlobs,
        projectId: PROJECT,
        compression: "zstd",
      });

      expect(await decodeJobEnvelope({ value: encoded, tieredBlobs })).toEqual(jobData);
    });
  });

  describe("given msgpack writes are enabled", () => {
    describe("when the payload is over the msgpack threshold", () => {
      it("round-trips it", async () => {
        const { tieredBlobs } = makeTiered();
        const jobData = bigPayload();

        const encoded = await encodeJobEnvelope({
          jobData,
          tieredBlobs,
          projectId: PROJECT,
          payloadCodec: "msgpack",
        });

        expect(await decodeJobEnvelope({ value: encoded, tieredBlobs })).toEqual(jobData);
      });

      it("stores it under a different content-addressed key than the JSON encoding", async () => {
        // The codec is folded into the content hash. Without that, a JSON-encoded
        // and a msgpack-encoded copy of the same payload would collide on one
        // content-addressed key with DIFFERENT bytes, and whichever landed second
        // would silently dedup onto the first — handing a reader a codec it was
        // not expecting. Both encodings go into the SAME store here, so a
        // collision would show up as a single key.
        const jobData = bigPayload();
        const { tieredBlobs, redisBlobs, objectStore } = makeTiered();

        await encodeJobEnvelope({
          jobData,
          tieredBlobs,
          projectId: PROJECT,
          payloadCodec: "msgpack",
        });
        await encodeJobEnvelope({
          jobData,
          tieredBlobs,
          projectId: PROJECT,
          payloadCodec: "json",
        });

        const keys = [...redisBlobs.store.keys(), ...objectStore.store.keys()];
        expect(keys).toHaveLength(2);
      });
    });

    describe("when the payload is under the msgpack threshold", () => {
      it("keeps it as JSON, because msgpack is slower than JSON.stringify at that size", async () => {
        const { tieredBlobs } = makeTiered();
        const jobData = smallPayload();

        const encoded = await encodeJobEnvelope({
          jobData,
          tieredBlobs,
          projectId: PROJECT,
          payloadCodec: "msgpack",
        });

        // Small bodies stay inline in the envelope, and an inline body is always
        // JSON — so the payload is readable in the raw envelope string.
        expect(encoded).toContain('"input":{"value":"hello"}');
        expect(await decodeJobEnvelope({ value: encoded, tieredBlobs })).toEqual(jobData);
      });
    });
  });

  describe("given the same event is fanned out to several subscribers", () => {
    it("collapses them onto one stored blob", async () => {
      // The dedup that makes the codec choice worth anything: one encode, N
      // decodes. Machinery (__jobName et al) is lifted into the header so it
      // cannot perturb the content hash.
      const { tieredBlobs, objectStore, redisBlobs } = makeTiered();

      const payload = bigPayload();
      const subscribers = ["subscriber-a", "subscriber-b", "subscriber-c"];

      const encoded = await Promise.all(
        subscribers.map((jobName) =>
          encodeJobEnvelope({
            jobData: { ...payload, __jobName: jobName },
            tieredBlobs,
            projectId: PROJECT,
            compression: "zstd",
            payloadCodec: "msgpack",
          }),
        ),
      );

      const stored = [...redisBlobs.store.values(), ...objectStore.store.values()];
      expect(stored).toHaveLength(1);

      for (const [i, value] of encoded.entries()) {
        expect(await decodeJobEnvelope({ value, tieredBlobs })).toEqual({
          ...payload,
          __jobName: subscribers[i],
        });
      }
    });
  });
});
