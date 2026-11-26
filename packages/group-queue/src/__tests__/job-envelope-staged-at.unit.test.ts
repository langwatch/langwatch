import { describe, expect, it } from "vitest";

import {
  decodeJobEnvelope,
  encodeJobEnvelope,
  readJobStagedAt,
  splitEnvelope,
  withJobAttempt,
} from "../jobEnvelope.ts";
import { createTenantId } from "../storage.ts";
import { TieredBlobStore } from "../tieredBlobStore.ts";
import { InMemoryJobBlobStore, InMemoryObjectStore, mintTestUri } from "./blob-test-doubles.ts";

const PROJECT = createTenantId("project-1");
const STAGED_AT_MS = Date.parse("2026-11-16T09:00:00.000Z");

const jobData = {
  __pipelineName: "trace_processing",
  __jobType: "projection",
  __jobName: "traceSummary",
  id: "event_1",
  data: { traceId: "trace_1" },
};

function blobStore(): TieredBlobStore {
  return new TieredBlobStore({
    redisBlobs: new InMemoryJobBlobStore(),
    objectStoreFor: () => new InMemoryObjectStore(),
    mintUri: mintTestUri,
    resolveDestination: async () => ({ kind: "s3", bucket: "test-bucket" }),
  });
}

function encode({
  data = jobData,
  stagedAtMs,
  tieredBlobs = blobStore(),
}: {
  data?: Record<string, unknown>;
  stagedAtMs?: number;
  tieredBlobs?: TieredBlobStore;
}): Promise<string> {
  return encodeJobEnvelope({
    jobData: data,
    tieredBlobs,
    projectId: PROJECT,
    queueName: "q",
    stagedAtMs,
  });
}

describe("job envelope staged time", () => {
  describe("given a job staged with its staging time", () => {
    describe("when the time is read from the message", () => {
      it("reports the time it was staged", async () => {
        expect(readJobStagedAt(await encode({ stagedAtMs: STAGED_AT_MS }))).toBe(STAGED_AT_MS);
      });
    });

    describe("when the handler payload is decoded", () => {
      it("keeps the time out of the payload, so no handler ever sees it", async () => {
        const decoded = await decodeJobEnvelope({
          value: await encode({ stagedAtMs: STAGED_AT_MS }),
        });

        expect(Object.values(decoded)).not.toContain(STAGED_AT_MS);
        expect(decoded).not.toHaveProperty("a");
      });
    });

    describe("when its body is held outside the message", () => {
      it("still reports the time from the header alone", async () => {
        const encoded = await encode({
          data: { ...jobData, bulk: "x".repeat(200_000) },
          stagedAtMs: STAGED_AT_MS,
        });

        expect(splitEnvelope(encoded).body).toBe("");
        expect(readJobStagedAt(encoded)).toBe(STAGED_AT_MS);
      });
    });

    describe("when a retry rewrites its attempt", () => {
      /** @scenario "a retried job keeps the time it was first staged" */
      it("keeps the original staging time", async () => {
        const retried = withJobAttempt({
          value: await encode({ stagedAtMs: STAGED_AT_MS }),
          attempt: 2,
        });

        expect(readJobStagedAt(retried)).toBe(STAGED_AT_MS);
      });
    });
  });

  describe("given a job staged by a release that did not record the time", () => {
    it("reports no time, so a reader falls back to the ready score", async () => {
      expect(readJobStagedAt(await encode({}))).toBeNull();
    });
  });

  describe("given a value that is not an envelope", () => {
    it("reports no time instead of throwing", () => {
      expect(readJobStagedAt('{"id":"event_1"}')).toBeNull();
      expect(readJobStagedAt("GQ2|9")).toBeNull();
    });
  });
});
