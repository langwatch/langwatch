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
      /** @scenario an envelope whose referenced blob is gone is classified as a missing blob */
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
        /** @scenario an envelope that cannot be parsed is classified as malformed */
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
      /** @scenario a body that cannot be read back is classified as body-unreadable */
      it("names the failure body_unreadable", async () => {
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
        expect((err as DecodeFailureError).reason).toBe("body_unreadable");
      });

      /** @scenario classification survives an exception message it does not own */
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
        expect(err.reason).toBe("body_unreadable");
        expect(Object.hasOwn(err, "reason")).toBe(true);
      });
    });
  });

  describe("given a body that would inflate past the decode ceiling", () => {
    describe("when it is decoded", () => {
      it("still raises PayloadTooLargeError rather than a decode failure", async () => {
        // Regression guard on #5538 itself: readBody() must let this through
        // untouched. It is the poison-PARK signal (#5661) — if it were recast as
        // body_unreadable the group would be dropped instead of parked, and
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

  describe("given a body whose parse error would echo the payload back", () => {
    // V8 quotes the offending input into the message:
    //   JSON.parse("patient@…") -> Unexpected token 'p', "patient@ho"... is not valid JSON
    // That message reaches the drop log, and redactStorageUrisInText only strips
    // storage URIs — so without a guard, raw body lands in prod logs. AC1 says
    // "never raw payload or tenant PII". Pre-dates this fix (#5736 started
    // logging `err` while the bare-JSON path threw a raw SyntaxError).
    // The redactor is an ALLOWLIST: keep the leading diagnosis, drop everything
    // from the first `"`/`[`/`{` — where every parser hands input back.
    //
    // v1 of this test asserted the WHOLE secret was absent and passed with the
    // guard removed (V8 echoes ~10 chars, so the full secret is never present
    // either way). v2 asserted the echoed prefix. v3 (here) adds the cases a
    // security review found v2's REGEX still leaked: V8 only appends `"..."` at
    // ~21+ chars and echoes the whole string below that, so a 9-digit SSN or a
    // 6-digit OTP sailed straight through the old `{12,}` threshold.
    const LEAKY: Array<{ name: string; payload: string; secret: string }> = [
      {
        name: "a long payload (V8 truncates with an ellipsis)",
        payload: "patient@hospital.example is HIV positive",
        secret: "patient@ho",
      },
      {
        name: "a 9-digit secret (V8 echoes it WHOLE — no ellipsis)",
        payload: "x123456789",
        secret: "123456789",
      },
      {
        name: "a short secret under the old 12-char threshold",
        payload: "xab12cd",
        secret: "ab12cd",
      },
    ];

    for (const { name, payload, secret } of LEAKY) {
      describe(`when an inline bare-JSON body fails to parse — ${name}`, () => {
        it("keeps the payload out of the thrown message", async () => {
          const err = (await decodeJobEnvelope({ value: payload })
            .then(() => null)
            .catch((e: unknown) => e)) as DecodeFailureError;

          expect(err).toBeInstanceOf(DecodeFailureError);
          expect(err.message).not.toContain(secret);
          // Positive half — without it the negative could pass vacuously (wrong
          // Node, reshaped message). This can only pass if the redactor ran.
          expect(err.message).toContain("SyntaxError");
          expect(err.message).toContain("failed to parse");
        });
      });
    }

    describe("when an offloaded body fails to parse", () => {
      it("keeps the payload out of the thrown message", async () => {
        const { tieredBlobs, redisBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: offloadable(),
          tieredBlobs,
          projectId,
        });
        // Valid gzip, so it inflates — then fails to PARSE, echoing its content.
        const { gzipSync } = await import("node:zlib");
        for (const key of [...redisBlobs.store.keys()]) {
          redisBlobs.store.set(
            key,
            gzipSync(Buffer.from("patient@hospital.example is HIV positive")),
          );
        }

        const err = (await decodeJobEnvelope({ value: encoded, tieredBlobs })
          .then(() => null)
          .catch((e: unknown) => e)) as DecodeFailureError;

        expect(err).toBeInstanceOf(DecodeFailureError);
        expect(err.message).not.toContain("patient@ho");
        expect(err.message).toContain("SyntaxError");
      });
    });

    describe("when the failure text carries no input echo at all", () => {
      it("keeps the whole diagnosis rather than amputating it", async () => {
        // zlib never echoes input ("incorrect header check"), so the allowlist
        // must leave an already-safe message intact.
        //
        // Reaching zlib at all takes care: `decompress` SNIFFS (detectCompression)
        // and passes unrecognised bytes straight through as "none", so random
        // garbage fails later at the parse, not in zlib. Keep the gzip magic and
        // corrupt the deflate stream behind it.
        const { tieredBlobs, redisBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: offloadable(),
          tieredBlobs,
          projectId,
        });
        const { gzipSync } = await import("node:zlib");
        const corrupt = gzipSync(Buffer.from("hello"));
        corrupt.fill(0xff, 10, corrupt.length - 8); // magic intact, stream broken

        for (const key of [...redisBlobs.store.keys()]) {
          redisBlobs.store.set(key, corrupt);
        }

        const err = (await decodeJobEnvelope({ value: encoded, tieredBlobs })
          .then(() => null)
          .catch((e: unknown) => e)) as DecodeFailureError;

        expect(err.reason).toBe("body_unreadable");
        expect(err.message).toContain("decompress");
        // The zlib diagnosis survives the allowlist untouched.
        expect(err.message).toMatch(/check|invalid|incorrect|header/i);
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

        expect(d.format === "redis" || d.format === "s3").toBe(true);
        expect(d.version).toBe(2);
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

        expect(d.version).toBe(2);
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

        expect(d.format).toBe("ref");
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
