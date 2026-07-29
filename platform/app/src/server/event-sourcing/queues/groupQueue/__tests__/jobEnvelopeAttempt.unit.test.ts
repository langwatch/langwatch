import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  decodeJobEnvelope,
  encodeJobEnvelope,
  readJobAttempt,
  splitEnvelope,
  withJobAttempt,
} from "../jobEnvelope";
import { TieredBlobStore } from "../tieredBlobStore";
import { InMemoryJobBlobStore, InMemoryObjectStore } from "./blobTestDoubles";

const PROJECT = createTenantId("project-1");

const jobData = (attempt?: number) => ({
  __pipelineName: "langy_conversation_processing",
  __jobType: "subscriber",
  __jobName: "pm:langyConversation",
  ...(attempt === undefined ? {} : { __attempt: attempt }),
  id: "event_000649zPnIW3V0Ug6yVk9DECNYK3S",
  data: { conversationId: "langyconv_1" },
});

function blobStore(): TieredBlobStore {
  return new TieredBlobStore({
    redisBlobs: new InMemoryJobBlobStore(),
    objectStoreFor: () => new InMemoryObjectStore(),
    resolveDestination: async () => ({ kind: "s3", bucket: "test-bucket" }),
  });
}

/**
 * A GQ2 envelope — what the composition root produces. GQ1 is reached only
 * when a tiered store or the tenant is missing, which the encoder treats as a
 * downgrade worth a metric and a warning.
 */
async function encodeGq2(
  data: Record<string, unknown>,
  tieredBlobs: TieredBlobStore = blobStore(),
): Promise<string> {
  return await encodeJobEnvelope({
    jobData: data,
    tieredBlobs,
    projectId: PROJECT,
    writesEnabled: true,
    queueName: "q",
  });
}

describe("job envelope retry attempt", () => {
  beforeEach(() => {
    vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("given a job that has never been retried", () => {
    describe("when its attempt is read from the message", () => {
      /** @scenario A job sent for the first time carries no attempt on its message */
      it("reports no attempt yet rather than inventing one", async () => {
        expect(readJobAttempt(await encodeGq2(jobData()))).toBeNull();
      });
    });
  });

  describe("given a re-staged job whose body is held outside the message", () => {
    /** A blob-offloaded envelope: the body is empty, everything is in the header. */
    async function offloaded(attempt: number): Promise<string> {
      return await encodeGq2({
        ...jobData(attempt),
        bulk: "x".repeat(200_000),
      });
    }

    describe("when its attempt is read while the body is unreachable", () => {
      /** @scenario A retried job's attempt is readable without fetching its body */
      /** @scenario "Exhausted-retry accounting reads only the envelope header" */
      it("reports the attempt from the message alone", async () => {
        const encoded = await offloaded(7);

        // Nothing here touches a blob store: the value alone answers.
        expect(splitEnvelope(encoded).body).toBe("");
        expect(readJobAttempt(encoded)).toBe(7);
      });
    });
  });

  describe("given a staged job carrying an attempt", () => {
    describe("when the queue advances that job to its next attempt", () => {
      /** @scenario Advancing a job's attempt leaves its payload bytes untouched */
      /** @scenario "Retried jobs are re-staged as envelopes" */
      it("leaves the body bytes untouched", async () => {
        const encoded = await encodeGq2(jobData(3));
        const advanced = withJobAttempt({ value: encoded, attempt: 4 });

        expect(splitEnvelope(advanced).body).toBe(splitEnvelope(encoded).body);
        expect(readJobAttempt(advanced)).toBe(4);
      });

      /** @scenario Advancing a job's attempt leaves its payload bytes untouched */
      it("keeps the rest of the job intact", async () => {
        const encoded = await encodeGq2(jobData(3));
        const advanced = withJobAttempt({ value: encoded, attempt: 4 });

        expect(await decodeJobEnvelope({ value: advanced })).toEqual(
          jobData(4),
        );
      });

      /** @scenario Advancing a job's attempt does not split the body it shares with identical jobs */
      it("keeps the pointer to the shared stored body", async () => {
        const blobs = blobStore();
        const first = await encodeGq2(
          { ...jobData(1), bulk: "x".repeat(200_000) },
          blobs,
        );
        const advanced = withJobAttempt({ value: first, attempt: 2 });

        // Same body reference, so the shared blob is neither split nor re-written.
        const { header: before } = splitEnvelope(first);
        const { header: after } = splitEnvelope(advanced);
        expect(after.h).toBe(before.h);
        expect(after.ref).toEqual(before.ref);
      });
    });
  });

  describe("given a staged job advanced through attempts of different digit widths", () => {
    describe("when each one is read back", () => {
      /** @scenario A job stays readable as its attempt count grows wider */
      it("stays readable at every width", async () => {
        // The envelope is `<prefix><headerByteLength>|<header><body>`, so
        // widening 9 -> 10 -> 100 changes the header's length and the prefix
        // must be recomputed with it. A splice that edited the header in place
        // would corrupt the value at exactly these boundaries.
        let value = await encodeGq2(jobData(1));

        for (const attempt of [9, 10, 99, 100, 1000]) {
          value = withJobAttempt({ value, attempt });
          expect(readJobAttempt(value)).toBe(attempt);
          expect(await decodeJobEnvelope({ value })).toEqual(jobData(attempt));
        }
      });
    });
  });

  describe("given a job in a format that keeps its attempt inside the body", () => {
    describe("when its attempt is read from the message alone", () => {
      /** @scenario A job in a format that predates the readable attempt reports no attempt rather than a wrong one */
      it("reports no attempt and does not throw", () => {
        // A GQ1 envelope lifts only the routing trio into the header.
        const gq1 = 'GQ1|29|{"v":1,"e":"j","t":"subscriber"}{"__attempt":9}';

        expect(readJobAttempt(gq1)).toBeNull();
        expect(withJobAttempt({ value: gq1, attempt: 10 })).toBe(gq1);
      });

      /** @scenario A job in a format that predates the readable attempt reports no attempt rather than a wrong one */
      it("survives a value it cannot parse at all", () => {
        expect(readJobAttempt("GQ2|not-an-envelope")).toBeNull();
        expect(readJobAttempt("{ broken json")).toBeNull();
        expect(withJobAttempt({ value: "GQ2|nope", attempt: 2 })).toBe(
          "GQ2|nope",
        );
      });
    });
  });

  describe("given a legacy bare-JSON job", () => {
    describe("when its attempt is read from the message", () => {
      it("reads the attempt straight off the payload", () => {
        expect(readJobAttempt(JSON.stringify({ __attempt: 5 }))).toBe(5);
      });
    });
  });
});
