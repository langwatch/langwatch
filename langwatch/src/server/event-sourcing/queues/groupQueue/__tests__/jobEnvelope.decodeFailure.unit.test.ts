import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import { MAX_BLOB_BYTES } from "../blobConstants";
import {
  DecodeFailureError,
  decodeJobEnvelope,
  encodeJobEnvelope,
  PayloadTooLargeError,
  readEnvelopeDescriptor,
} from "../jobEnvelope";
import { TieredBlobStore } from "../tieredBlobStore";
import { InMemoryJobBlobStore, InMemoryObjectStore } from "./blobTestDoubles";

/**
 * #5538. The drop path used to throw plain `Error`s, so every decode failure
 * looked identical: one catch-all "Failed to parse staged job data". These tests
 * pin the discriminator that separates a body that is GONE (irreducible loss)
 * from a body that is merely unreadable to THIS worker (recoverable — do not
 * retire it).
 *
 * The load-bearing rule under test: classification comes from the error TYPE.
 * Message text is NOT a classifier — zlib's wording is Node-version-dependent
 * and not ours to own, so an alert built on substrings breaks on a runtime
 * upgrade. No test in this file may assert on `err.message` to identify a class.
 */
describe("jobEnvelope decode failures", () => {
  const projectId = createTenantId("project_5538");

  beforeEach(() => {
    vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeTiered({ s3ThresholdBytes = 1024 * 1024 } = {}) {
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

  /**
   * Over BOTH offload thresholds — GQ2's 4KB inline ceiling and GQ1's 32KB blob
   * threshold — so each format actually puts the body in a blob rather than
   * inlining it as gz. An inlined body has no blob to lose, which is not the
   * case under test.
   */
  const offloadable = () => ({
    __pipelineName: "traces",
    __jobType: "command",
    __jobName: "recordSpan",
    bulk: "x".repeat(64 * 1024),
  });

  describe("given an envelope whose referenced blob is gone", () => {
    describe("when it is decoded", () => {
      it("names the failure missing_blob", async () => {
        const { tieredBlobs, redisBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: offloadable(),
          tieredBlobs,
          projectId,
        });
        // The eviction this issue is about: the envelope still points at a blob
        // that no longer exists.
        redisBlobs.store.clear();

        const err = await decodeJobEnvelope({ value: encoded, tieredBlobs })
          .then(() => null)
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(DecodeFailureError);
        expect((err as DecodeFailureError).reason).toBe("missing_blob");
      });
    });
  });

  describe("given a legacy GQ1 envelope whose offloaded blob is gone", () => {
    describe("when it is decoded", () => {
      it("names the failure missing_blob", async () => {
        const blobs = new InMemoryJobBlobStore();
        const encoded = await encodeJobEnvelope({
          jobData: offloadable(),
          blobs,
          projectId,
        });
        blobs.store.clear();

        const err = await decodeJobEnvelope({ value: encoded, blobs })
          .then(() => null)
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(DecodeFailureError);
        expect((err as DecodeFailureError).reason).toBe("missing_blob");
      });
    });
  });

  describe("given an envelope whose structure is unreadable", () => {
    // Each is a distinct throw site in splitEnvelope/decodeJobEnvelope.
    // Prefix must be a REAL one ("GQ1|"/"GQ2|") or isEnvelope() is false and the
    // value takes the bare-JSON path instead of the envelope path under test.
    const cases: Array<{ name: string; value: string }> = [
      { name: "no header length delimiter", value: "GQ2|" + "x".repeat(20) },
      { name: "a non-numeric header length", value: "GQ2|abc|{}" },
      { name: "a zero header length", value: "GQ2|0|{}" },
    ];

    for (const { name, value } of cases) {
      describe(`when it has ${name}`, () => {
        it("names the failure malformed_envelope", async () => {
          const err = await decodeJobEnvelope({ value })
            .then(() => null)
            .catch((e: unknown) => e);

          expect(err).toBeInstanceOf(DecodeFailureError);
          expect((err as DecodeFailureError).reason).toBe("malformed_envelope");
        });
      });
    }
  });

  describe("given an envelope whose body will not decompress", () => {
    describe("when it is decoded", () => {
      it("names the failure decompress_failure", async () => {
        const { tieredBlobs, redisBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: offloadable(),
          tieredBlobs,
          projectId,
        });
        // Same key, garbage bytes: the body is PRESENT and unreadable — the
        // rolling-deploy codec-skew shape, not an eviction.
        for (const key of [...redisBlobs.store.keys()]) {
          redisBlobs.store.set(key, Buffer.from("not a valid compressed body"));
        }

        const err = await decodeJobEnvelope({ value: encoded, tieredBlobs })
          .then(() => null)
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(DecodeFailureError);
        expect((err as DecodeFailureError).reason).toBe("decompress_failure");
      });

      it("classifies by error type, not by the zlib message text", async () => {
        const { tieredBlobs, redisBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: offloadable(),
          tieredBlobs,
          projectId,
        });
        for (const key of [...redisBlobs.store.keys()]) {
          redisBlobs.store.set(key, Buffer.from("garbage"));
        }

        const err = (await decodeJobEnvelope({ value: encoded, tieredBlobs })
          .then(() => null)
          .catch((e: unknown) => e)) as DecodeFailureError;

        // The whole point of AC3: the reason is readable as a field, so no
        // consumer has to substring-match a message it does not own. Pin that
        // the discriminator survives regardless of what zlib chose to say.
        expect(err.reason).toBe("decompress_failure");
        expect(Object.hasOwn(err, "reason")).toBe(true);
      });
    });
  });

  describe("given a body that would inflate past the decode ceiling", () => {
    describe("when it is decoded", () => {
      it("still raises PayloadTooLargeError rather than a decode failure", async () => {
        // Regression guard on #5538 itself: readBody() must let this through
        // untouched. It is the poison-PARK signal (#5661) — if it were recast as
        // decompress_failure the group would be dropped instead of parked, and
        // replay would re-materialize the same over-cap value forever.
        const { tieredBlobs, redisBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: offloadable(),
          tieredBlobs,
          projectId,
        });
        const bomb = Buffer.alloc(MAX_BLOB_BYTES + 1, "a");
        const { gzipSync } = await import("node:zlib");
        for (const key of [...redisBlobs.store.keys()]) {
          redisBlobs.store.set(key, gzipSync(bomb));
        }

        const err = await decodeJobEnvelope({ value: encoded, tieredBlobs })
          .then(() => null)
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(PayloadTooLargeError);
        expect(err).not.toBeInstanceOf(DecodeFailureError);
      });
    });
  });

  describe("readEnvelopeDescriptor", () => {
    describe("given a GQ2 envelope", () => {
      it("reports the format, version and the tiered blob hash", async () => {
        const { tieredBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: offloadable(),
          tieredBlobs,
          projectId,
        });

        const d = readEnvelopeDescriptor(encoded);

        expect(d.e === "redis" || d.e === "s3").toBe(true);
        expect(d.v).toBe(2);
        expect(typeof d.blobId).toBe("string");
        expect(d.blobId).not.toBe("");
      });

      it("still reports the descriptor after the blob is gone", async () => {
        // The reason this reader exists: the header outlives the body, so a
        // value we could not decode can still say what it WAS.
        const { tieredBlobs, redisBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: offloadable(),
          tieredBlobs,
          projectId,
        });
        redisBlobs.store.clear();

        const d = readEnvelopeDescriptor(encoded);

        expect(d.v).toBe(2);
        expect(typeof d.blobId).toBe("string");
      });
    });

    describe("given a legacy GQ1 envelope", () => {
      it("reports the offloaded blob id", async () => {
        const blobs = new InMemoryJobBlobStore();
        const encoded = await encodeJobEnvelope({
          jobData: offloadable(),
          blobs,
          projectId,
        });

        const d = readEnvelopeDescriptor(encoded);

        expect(d.e).toBe("ref");
        expect(typeof d.blobId).toBe("string");
      });
    });

    describe("given a value it cannot read", () => {
      const junk: Array<{ name: string; value: string }> = [
        { name: "bare JSON", value: JSON.stringify({ a: 1 }) },
        { name: "an empty string", value: "" },
        { name: "a truncated envelope", value: "GQ2:" },
        { name: "a garbage envelope", value: "GQ2:9|not-json-at-all" },
      ];

      for (const { name, value } of junk) {
        it(`returns nulls for ${name} instead of throwing`, () => {
          // Never-throws is load-bearing: this runs INSIDE the drop path's catch
          // block. If it threw, it would mask the original failure it exists to
          // describe.
          expect(() => readEnvelopeDescriptor(value)).not.toThrow();
          const d = readEnvelopeDescriptor(value);
          expect(d.blobId).toBeNull();
        });
      }
    });
  });
});
