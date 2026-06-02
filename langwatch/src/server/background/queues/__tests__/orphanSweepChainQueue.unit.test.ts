import { describe, expect, it, vi } from "vitest";

// No Redis in unit env → QueueWithFallback takes its no-connection path.
vi.mock("../../../redis", () => ({ connection: undefined }));

// Keep the worker import light and observable so we can assert it is never run
// inline when seeding fails.
const { runOrphanSweepChainJob } = vi.hoisted(() => ({
  runOrphanSweepChainJob: vi.fn(),
}));
vi.mock("../../workers/orphanSweepChainWorker", () => ({
  runOrphanSweepChainJob,
}));

import {
  orphanSweepChainJobId,
  seedOrphanSweepChain,
} from "../orphanSweepChainQueue";

describe("orphanSweepChainJobId", () => {
  it("is stable per tenant", () => {
    expect(orphanSweepChainJobId("tenant-1")).toBe(
      orphanSweepChainJobId("tenant-1"),
    );
  });

  it("includes the tenant id", () => {
    expect(orphanSweepChainJobId("abc123")).toContain("abc123");
  });

  // Regression: ':' made BullMQ reject the add ("Custom Ids cannot contain :"),
  // which fell back to running the sweep inline per ingestion event.
  it("contains no ':' character", () => {
    expect(orphanSweepChainJobId("tenant-1")).not.toContain(":");
  });
});

describe("seedOrphanSweepChain", () => {
  it("is best-effort: swallows enqueue failure and never runs the sweep inline", async () => {
    // No connection + fallbackToInline:false ⇒ add() throws. The seed must
    // catch it (so it never reaches the ingestion path) and must NOT invoke the
    // worker synchronously inline.
    await expect(seedOrphanSweepChain("tenant-1")).resolves.toBeUndefined();
    expect(runOrphanSweepChainJob).not.toHaveBeenCalled();
  });
});
