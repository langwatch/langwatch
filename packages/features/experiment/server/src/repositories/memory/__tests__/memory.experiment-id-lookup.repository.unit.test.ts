import { describe, expect, it } from "vitest";
import { MemoryExperimentIdLookupRepository } from "../memory.experiment-id-lookup.repository";

describe("MemoryExperimentIdLookupRepository", () => {
  it("always returns null", async () => {
    const repository = MemoryExperimentIdLookupRepository.create();

    await expect(
      repository.tryFindExperimentId({ tenantId: "tenant-1", runId: "run-1" }),
    ).resolves.toBeNull();
  });
});
