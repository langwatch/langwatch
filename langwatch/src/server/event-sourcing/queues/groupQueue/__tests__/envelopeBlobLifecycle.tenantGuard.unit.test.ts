import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";

import { EnvelopeBlobLifecycle } from "../envelopeBlobLifecycle";
import type { EnvelopeHeader } from "../jobEnvelope";
import type { BlobRef } from "../tieredBlobStore";

/**
 * The decode tenant guard refuses BEFORE any store is touched, so it is
 * exercisable without Redis or an object store. The stub exists only to satisfy
 * construction — any call on it is a test failure by definition, because
 * reaching a store means the guard let a cross-tenant ref through.
 */
const unreachableRedis = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "then") return undefined; // not a thenable
      return () => {
        throw new Error(
          `Redis.${String(prop)}() reached — the tenant guard should have refused first`,
        );
      };
    },
  },
) as unknown as Redis;

const QUEUE = "{test/tenantguard}";

function makeLifecycle(): EnvelopeBlobLifecycle {
  return new EnvelopeBlobLifecycle({
    redis: unreachableRedis,
    queueName: QUEUE,
  });
}

/** Builds a GQ2 envelope directly, so a header can carry (or omit) any field. */
function envelope(header: EnvelopeHeader, body = ""): string {
  const headerJson = JSON.stringify(header);
  return `GQ2|${Buffer.byteLength(headerJson)}|${headerJson}${body}`;
}

const VICTIM_REF: BlobRef = {
  tier: "redis",
  projectId: "proj-victim" as BlobRef["projectId"],
  hash: "deadbeefdeadbeef",
};

describe("EnvelopeBlobLifecycle decode tenant guard", () => {
  describe("given an envelope whose blob ref belongs to another tenant", () => {
    describe("when it carries a lease holder id", () => {
      it("refuses the cross-tenant read", async () => {
        const value = envelope({
          e: "redis",
          ref: VICTIM_REF,
          h: "holder-1",
        } as EnvelopeHeader);

        await expect(
          makeLifecycle().decode({ value, groupId: "proj-attacker/agg" }),
        ).rejects.toThrow(/tenant mismatch/i);
      });
    });

    // Regression: the guard used to key off the lease, which additionally
    // requires `header.h`. Without it the envelope yielded no lease, the check
    // was skipped entirely, and decodeJobEnvelope — which has no tenant check
    // of its own — fetched the victim's blob.
    describe("when it carries no lease holder id", () => {
      /** @scenario "A tampered ref cannot read another tenant's blob" */
      it("still refuses the cross-tenant read", async () => {
        const value = envelope({
          e: "redis",
          ref: VICTIM_REF,
        } as EnvelopeHeader);

        await expect(
          makeLifecycle().decode({ value, groupId: "proj-attacker/agg" }),
        ).rejects.toThrow(/tenant mismatch/i);
      });

      it("refuses an s3-tier ref just the same", async () => {
        const value = envelope({
          e: "s3",
          ref: { ...VICTIM_REF, tier: "s3" },
        } as EnvelopeHeader);

        await expect(
          makeLifecycle().decode({ value, groupId: "proj-attacker/agg" }),
        ).rejects.toThrow(/tenant mismatch/i);
      });
    });
  });

  describe("given a group id with no tenant prefix", () => {
    describe("when a tiered envelope is decoded", () => {
      it("refuses, rather than matching undefined against undefined", async () => {
        const value = envelope({
          e: "redis",
          ref: VICTIM_REF,
        } as EnvelopeHeader);

        await expect(
          makeLifecycle().decode({ value, groupId: "untenanted-agg" }),
        ).rejects.toThrow(/tenant mismatch/i);
      });
    });
  });
});
