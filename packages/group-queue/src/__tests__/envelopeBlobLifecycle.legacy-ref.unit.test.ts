import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { EnvelopeBlobLifecycle } from "../envelopeBlobLifecycle.ts";
import { TransientBlobStoreError } from "../tieredBlobStore.ts";

/** A 3.20.1 GQ1 value whose body was offloaded to the queue's blob keys (#9840). */
const blobId = "5f0c2d7e-3b1a-4c8e-9d2f-0a1b2c3d4e5f";
const header = JSON.stringify({ v: 1, e: "ref", r: blobId, p: "trace_processing", s: 2048 });
const value = `GQ1|${Buffer.byteLength(header)}|${header}`;

function lifecycleOver(getexBuffer: () => Promise<Buffer | null>): EnvelopeBlobLifecycle {
  return new EnvelopeBlobLifecycle({
    redis: redisDouble({ getexBuffer }),
    queueName: "{test/legacyref}",
  });
}

describe("EnvelopeBlobLifecycle decode of a GQ1 offloaded body", () => {
  describe("when the read of the body fails for a moment", () => {
    /** @scenario "A GQ1 job whose offloaded body cannot be read for a moment is retried, not dropped" */
    it("fails as a transient blob-store error for the group's tenant, so the job retries", async () => {
      const lifecycle = lifecycleOver(async () => {
        throw new Error("Connection is closed.");
      });

      const failure = await lifecycle
        .decode({ value, groupId: "proj-a/agg" })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(TransientBlobStoreError);
      expect(failure).toMatchObject({ projectId: "proj-a", hash: blobId });
    });
  });

  describe("when the read fails for a group without a tenant prefix", () => {
    /** @scenario "A GQ1 job whose offloaded body cannot be read for a moment is retried, not dropped" */
    it("still fails as a transient blob-store error, so the job retries", async () => {
      const lifecycle = lifecycleOver(async () => {
        throw new Error("Connection is closed.");
      });

      const failure = await lifecycle
        .decode({ value, groupId: "untenanted-group" })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(TransientBlobStoreError);
      expect(failure).toMatchObject({ projectId: undefined, hash: blobId });
    });
  });

  describe("when the body is gone", () => {
    /** @scenario "A GQ1 job whose offloaded body cannot be read for a moment is retried, not dropped" */
    it("is still a missing blob", async () => {
      const lifecycle = lifecycleOver(async () => null);

      await expect(lifecycle.decode({ value, groupId: "proj-a/agg" })).rejects.toMatchObject({
        reason: "missing_blob",
      });
    });
  });
});
