import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";

import {
  decodeJobEnvelope,
  encodeJobEnvelope,
  readEnvelopeDescriptor,
  readJobRecoveryKey,
  readJobRoutingMeta,
  splitEnvelope,
} from "../jobEnvelope";
import { TieredBlobStore } from "../tieredBlobStore";
import { InMemoryJobBlobStore, InMemoryObjectStore } from "./blobTestDoubles";

// #718: the recovery key names a dropped reactor job back to its event, and the
// whole point is that it rides the ENVELOPE HEADER — so a value whose blob is gone
// (missing_blob) can still say WHICH event it was. Reactor jobs stage
// { event, foldState } with no top-level .id, so without this the event id exists
// only inside the lost blob.

const PROJECT = createTenantId("project-recovery");

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

// A reactor-shaped payload, comfortably over INLINE_CEILING_BYTES (4KB) so GQ2
// offloads the body to a blob and over BLOB_OFFLOAD_THRESHOLD_BYTES (32KB) so GQ1
// offloads too — the recovery key must survive losing that blob in both tiers.
const reactorPayload = (eventId: string) => ({
  __pipelineName: "trace-processing",
  __jobType: "reactor",
  __jobName: "governanceOcsfEventsSync",
  __recoveryKey: eventId,
  event: { id: eventId, kind: "trace.summary", body: "x".repeat(48 * 1024) },
  foldState: { count: 1 },
});

describe("jobEnvelope recovery key (#718)", () => {
  beforeEach(() => {
    vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("given a GQ2 offloaded job whose blob is gone", () => {
    describe("when the recovery key is read from the header", () => {
      it("returns the event id even though the body cannot be decoded", async () => {
        const { tieredBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: reactorPayload("evt-1"),
          tieredBlobs,
          projectId: PROJECT,
          writesEnabled: true,
        });

        // The blob is genuinely gone: decode against a fresh, empty store.
        const emptyStore = makeTiered().tieredBlobs;
        await expect(
          decodeJobEnvelope({ value: encoded, tieredBlobs: emptyStore }),
        ).rejects.toThrow();

        // Revert-check: without routingHeader writing header.k, this is null.
        expect(readJobRecoveryKey(encoded)).toBe("evt-1");
      });
    });
  });

  describe("given a GQ1 offloaded job whose blob is gone", () => {
    describe("when the recovery key is read from the header", () => {
      it("returns the event id even though the body cannot be decoded", async () => {
        // No tieredBlobs/projectId → GQ1 fallback; >32KB → offloaded blob.
        const encoded = await encodeJobEnvelope({
          jobData: reactorPayload("evt-1"),
          blobs: new InMemoryJobBlobStore(),
          writesEnabled: true,
        });

        const emptyBlobs = new InMemoryJobBlobStore();
        await expect(
          decodeJobEnvelope({ value: encoded, blobs: emptyBlobs }),
        ).rejects.toThrow();

        expect(readJobRecoveryKey(encoded)).toBe("evt-1");
      });
    });
  });

  describe("given values that are not well-formed key-bearing envelopes", () => {
    describe("when the recovery key is read", () => {
      it("never throws and returns null", () => {
        expect(readJobRecoveryKey('{"id":"legacy"}')).toBeNull(); // bare JSON
        expect(readJobRecoveryKey("GQ2|not-a-length|garbage")).toBeNull(); // malformed
        expect(readJobRecoveryKey("")).toBeNull(); // empty
      });

      it("returns null for a well-formed envelope that carries no key", async () => {
        const encoded = await encodeJobEnvelope({
          jobData: { __jobName: "n", event: { id: "e" } },
          writesEnabled: true,
        });
        expect(readJobRecoveryKey(encoded)).toBeNull();
      });
    });
  });

  describe("given two GQ2 jobs with identical bodies but different recovery keys", () => {
    describe("when both are encoded", () => {
      it("collapses them to the same content-addressed blob", async () => {
        const { tieredBlobs } = makeTiered();
        const body = { event: { id: "shared", body: "y".repeat(48 * 1024) }, foldState: {} };
        const a = await encodeJobEnvelope({
          jobData: { ...body, __recoveryKey: "evt-1" },
          tieredBlobs,
          projectId: PROJECT,
          writesEnabled: true,
        });
        const b = await encodeJobEnvelope({
          jobData: { ...body, __recoveryKey: "evt-2" },
          tieredBlobs,
          projectId: PROJECT,
          writesEnabled: true,
        });

        // The recovery key does NOT perturb the content hash — dedup intact.
        expect(readEnvelopeDescriptor(a).blobId).toBe(readEnvelopeDescriptor(b).blobId);
        // …and each keeps its own key.
        expect(readJobRecoveryKey(a)).toBe("evt-1");
        expect(readJobRecoveryKey(b)).toBe("evt-2");
      });
    });
  });

  describe("given a GQ2 job with a recovery key", () => {
    describe("when it is encoded", () => {
      it("lifts the key to header.k and does not duplicate it into header.m machinery", async () => {
        const { tieredBlobs } = makeTiered();
        const encoded = await encodeJobEnvelope({
          jobData: reactorPayload("evt-1"),
          tieredBlobs,
          projectId: PROJECT,
          writesEnabled: true,
        });
        const { header } = splitEnvelope(encoded);
        expect(header.k).toBe("evt-1");
        // Revert-check: without `delete machinery.__recoveryKey`, header.m carries it.
        expect(header.m ?? {}).not.toHaveProperty("__recoveryKey");
      });
    });
  });

  describe("given a key-bearing envelope of either tier", () => {
    describe("when it is decoded and described", () => {
      it("round-trips the body and still reports descriptor + routing", async () => {
        for (const tier of ["GQ2", "GQ1"] as const) {
          const jobData = reactorPayload("evt-1");
          const { encoded, decoded } =
            tier === "GQ2"
              ? await roundTripGq2(jobData)
              : await roundTripGq1(jobData);

          expect(decoded.event).toEqual(jobData.event);
          expect(decoded.foldState).toEqual(jobData.foldState);
          // Wire-format additions (header.k) must not break the shape readers.
          const d = readEnvelopeDescriptor(encoded);
          expect(d.format).not.toBeNull();
          expect(d.version).not.toBeNull();
          expect(d.blobId).not.toBeNull();
          expect(readJobRoutingMeta(encoded)).toEqual({
            pipelineName: "trace-processing",
            jobType: "reactor",
            jobName: "governanceOcsfEventsSync",
          });
        }
      });
    });
  });
});

async function roundTripGq2(jobData: Record<string, unknown>) {
  const { tieredBlobs } = makeTiered();
  const encoded = await encodeJobEnvelope({
    jobData,
    tieredBlobs,
    projectId: PROJECT,
    writesEnabled: true,
  });
  const decoded = await decodeJobEnvelope({ value: encoded, tieredBlobs });
  return { encoded, decoded };
}

async function roundTripGq1(jobData: Record<string, unknown>) {
  const blobs = new InMemoryJobBlobStore();
  const encoded = await encodeJobEnvelope({ jobData, blobs, writesEnabled: true });
  const decoded = await decodeJobEnvelope({ value: encoded, blobs });
  return { encoded, decoded };
}
