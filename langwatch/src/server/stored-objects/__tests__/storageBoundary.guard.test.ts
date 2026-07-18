/**
 * Storage boundary guard.
 *
 * `resolveProjectStorageDestination` answers "where does THIS PROJECT'S data
 * live", and for a BYOC tenant that is the tenant's OWN bucket
 * (`project-storage-destination.ts:50-52`). That is exactly right for customer
 * data — datasets, attachments, evaluation inputs — and exactly wrong for
 * anything internal, which then gets written into a customer's bucket.
 *
 * Nothing in the signature says which kind of data you are holding. Both
 * classes call the same resolver and mint the same `s3://{bucket}/{projectId}/
 * {sha256}` key shape, so the difference lives only in the caller's head — and
 * it is invisible in review, because each call site looks correct on its own.
 *
 * That is how internal GroupQueue payloads ended up in customer buckets, with
 * no `stored_objects` row to make them reclaimable. This test makes the
 * boundary explicit: adding a module to either list is a decision someone has
 * to make on purpose, in a diff, with a reason next to it.
 *
 * If this test fails because you added a call site, do not just append to the
 * list. Ask which kind of data you are storing. If it is not the customer's,
 * you want the internal store, not this resolver.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..", "..");

/** Modules that legitimately resolve a CUSTOMER's storage destination. */
const CUSTOMER_DATA_CALLERS = [
  // The resolver itself.
  "server/stored-objects/project-storage-destination.ts",
  // Stored objects are customer content by definition.
  "server/stored-objects/stored-objects.service.ts",
  // Datasets are customer content.
  "server/datasets/dataset-storage.ts",
  "server/datasets/dataset.service.ts",
  "server/datasets/local-dataset-storage.ts",
  "server/storage.ts",
  // One-off backfill of customer dataset content.
  "tasks/backfillDatasetContentToS3.ts",
] as const;

/**
 * Modules storing INTERNAL data that currently reach the customer resolver.
 *
 * Every entry here is a defect, not an exemption. Queue payloads are our own
 * operational data: they must live in our own bucket under our own prefix, so
 * that a lifecycle rule can expire them without any possibility of matching
 * customer objects, and so that a BYOC tenant's bucket never receives them.
 *
 * Shrink this list. Do not add to it.
 */
const KNOWN_INTERNAL_VIOLATIONS = [
  "server/event-sourcing/queues/groupQueue/tieredBlobStore.ts",
  "server/event-sourcing/eventSourcing.ts",
  "server/app-layer/ops/repositories/queue.redis.repository.ts",
] as const;

function modulesReferencing(symbol: string): string[] {
  // Both extensions: server code lives in `src/app` too, and a `.tsx` caller
  // would otherwise never be scanned — the guard would pass while the thing it
  // exists to catch walked past it.
  const files = globSync("**/*.{ts,tsx}", { cwd: SRC })
    .filter((f) => !f.includes("__tests__") && !f.endsWith(".test.ts"));

  return files
    .filter((f) => readFileSync(join(SRC, f), "utf-8").includes(symbol))
    .map((f) => f.split(/[\\/]/).join("/"))
    .sort();
}

describe("storage boundary", () => {
  describe("given a module resolves a project's storage destination", () => {
    it("is either a customer-data path or a known internal violation", () => {
      const callers = modulesReferencing("resolveProjectStorageDestination");
      // If the scan breaks, `undeclared` is empty and this test passes while
      // checking nothing. Fail on an empty scan instead.
      expect(callers.length).toBeGreaterThanOrEqual(
        CUSTOMER_DATA_CALLERS.length,
      );

      const declared = new Set<string>([
        ...CUSTOMER_DATA_CALLERS,
        ...KNOWN_INTERNAL_VIOLATIONS,
      ]);

      const undeclared = callers.filter((c) => !declared.has(c));

      // A new caller means someone is about to store something somewhere. Which
      // kind of data is it? If it is not the customer's, this resolver is the
      // wrong one — it can return the tenant's own bucket.
      expect(undeclared).toEqual([]);
    });
  });

  describe("given the shared S3 key minter", () => {
    it("is used only by the modules that own the shared key layout", () => {
      // `mintS3Uri` produces `s3://{bucket}/{projectId}/{sha256}` with no
      // data-class segment, so two callers writing different classes of data
      // collide in one key space. Anything reachable by a lifecycle rule for
      // one class is reachable for the other.
      const callers = modulesReferencing("mintS3Uri");
      expect(callers.length).toBeGreaterThan(0);

      expect(callers).toEqual([
        "server/event-sourcing/queues/groupQueue/tieredBlobStore.ts",
        "server/stored-objects/stored-objects.service.ts",
        "server/stored-objects/uri.ts",
      ]);
    });
  });

  describe("the internal-data violations", () => {
    it("are all still present, or the list is stale", () => {
      // Guards the other direction: once a violation is fixed, its entry must
      // go, or the list quietly becomes a record of problems we no longer have
      // and stops meaning anything.
      const callers = new Set(
        modulesReferencing("resolveProjectStorageDestination"),
      );
      const fixed = KNOWN_INTERNAL_VIOLATIONS.filter((v) => !callers.has(v));

      expect(fixed).toEqual([]);
    });
  });
});
