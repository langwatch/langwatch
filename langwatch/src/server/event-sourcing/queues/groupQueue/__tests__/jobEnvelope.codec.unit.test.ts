import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import { detectCompression, MSGPACK_MIN_BYTES } from "../bodyCodec";
import { decodeJobEnvelope, encodeJobEnvelope } from "../jobEnvelope";
import { TieredBlobStore } from "../tieredBlobStore";
import { InMemoryJobBlobStore, InMemoryObjectStore } from "./blobTestDoubles";

const PROJECT = createTenantId("project-codec");

function makeTiered() {
  const redisBlobs = new InMemoryJobBlobStore();
  const objectStore = new InMemoryObjectStore();
  const tieredBlobs = new TieredBlobStore({
    redisBlobs,
    objectStoreFor: () => objectStore,
    resolveDestination: async () => ({ kind: "s3", bucket: "test-bucket" }),
    s3ThresholdBytes: 256 * 1024,
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
  beforeEach(() => {
    vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("given a blob written before the codec change (gzip + JSON)", () => {
    describe("when a reader that supports zstd and msgpack decodes it", () => {
      it("decodes it without a migration", async () => {
        const { tieredBlobs, objectStore, redisBlobs } = makeTiered();
        const jobData = bigPayload();

        // Write with both new-format flags OFF — byte-for-byte what the
        // currently-deployed encoder produces.
        const encoded = await encodeJobEnvelope({
          jobData,
          tieredBlobs,
          projectId: PROJECT,
        });

        const stored = [
          ...redisBlobs.store.values(),
          ...objectStore.store.values(),
        ];
        expect(stored).toHaveLength(1);
        expect(detectCompression(stored[0]!)).toBe("gzip");

        // Now read it on a pod that has the new codecs enabled.
        vi.stubEnv("GROUP_QUEUE_ZSTD_WRITES_ENABLED", "true");
        vi.stubEnv("GROUP_QUEUE_MSGPACK_WRITES_ENABLED", "true");

        expect(
          await decodeJobEnvelope({ value: encoded, tieredBlobs }),
        ).toEqual(jobData);
      });
    });
  });

  describe("given zstd writes are enabled", () => {
    beforeEach(() => {
      vi.stubEnv("GROUP_QUEUE_ZSTD_WRITES_ENABLED", "true");
    });

    it("compresses the blob with zstd", async () => {
      const { tieredBlobs, objectStore, redisBlobs } = makeTiered();

      await encodeJobEnvelope({
        jobData: bigPayload(),
        tieredBlobs,
        projectId: PROJECT,
      });

      const stored = [
        ...redisBlobs.store.values(),
        ...objectStore.store.values(),
      ];
      expect(detectCompression(stored[0]!)).toBe("zstd");
    });

    it("round-trips the payload", async () => {
      const { tieredBlobs } = makeTiered();
      const jobData = bigPayload();

      const encoded = await encodeJobEnvelope({
        jobData,
        tieredBlobs,
        projectId: PROJECT,
      });

      expect(await decodeJobEnvelope({ value: encoded, tieredBlobs })).toEqual(
        jobData,
      );
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
      });

      expect(await decodeJobEnvelope({ value: encoded, tieredBlobs })).toEqual(
        jobData,
      );
    });
  });

  describe("given msgpack writes are enabled", () => {
    beforeEach(() => {
      vi.stubEnv("GROUP_QUEUE_MSGPACK_WRITES_ENABLED", "true");
    });

    describe("when the payload is over the msgpack threshold", () => {
      it("round-trips it", async () => {
        const { tieredBlobs } = makeTiered();
        const jobData = bigPayload();

        const encoded = await encodeJobEnvelope({
          jobData,
          tieredBlobs,
          projectId: PROJECT,
        });

        expect(
          await decodeJobEnvelope({ value: encoded, tieredBlobs }),
        ).toEqual(jobData);
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

        await encodeJobEnvelope({ jobData, tieredBlobs, projectId: PROJECT });

        vi.stubEnv("GROUP_QUEUE_MSGPACK_WRITES_ENABLED", "false");
        await encodeJobEnvelope({ jobData, tieredBlobs, projectId: PROJECT });

        const keys = [
          ...redisBlobs.store.keys(),
          ...objectStore.store.keys(),
        ];
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
        });

        // Small bodies stay inline in the envelope, and an inline body is always
        // JSON — so the payload is readable in the raw envelope string.
        expect(encoded).toContain('"input":{"value":"hello"}');
        expect(
          await decodeJobEnvelope({ value: encoded, tieredBlobs }),
        ).toEqual(jobData);
      });
    });
  });

  describe("given the same event is fanned out to several reactors", () => {
    it("collapses them onto one stored blob", async () => {
      // The dedup that makes the codec choice worth anything: one encode, N
      // decodes. Machinery (__jobName et al) is lifted into the header so it
      // cannot perturb the content hash.
      vi.stubEnv("GROUP_QUEUE_ZSTD_WRITES_ENABLED", "true");
      vi.stubEnv("GROUP_QUEUE_MSGPACK_WRITES_ENABLED", "true");
      const { tieredBlobs, objectStore, redisBlobs } = makeTiered();

      const payload = bigPayload();
      const reactors = ["reactor-a", "reactor-b", "reactor-c"];

      const encoded = await Promise.all(
        reactors.map((jobName) =>
          encodeJobEnvelope({
            jobData: { ...payload, __jobName: jobName },
            tieredBlobs,
            projectId: PROJECT,
          }),
        ),
      );

      const stored = [
        ...redisBlobs.store.values(),
        ...objectStore.store.values(),
      ];
      expect(stored).toHaveLength(1);

      for (const [i, value] of encoded.entries()) {
        expect(await decodeJobEnvelope({ value, tieredBlobs })).toEqual({
          ...payload,
          __jobName: reactors[i],
        });
      }
    });
  });
});
