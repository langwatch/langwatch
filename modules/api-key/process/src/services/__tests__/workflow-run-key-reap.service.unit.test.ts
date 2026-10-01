/**
 * What the workflow-run sweep may touch: the reserved name and the clock, once.
 * Spec: modules/workflow/specs/workflow-service.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRepository } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { WorkflowRunKeyReapService } from "../workflow-run-key-reap.service.ts";

function repositoryDouble(count = 0) {
  const revokeExpiredByName = vi.fn<ApiKeyRepository["revokeExpiredByName"]>(async () => count);
  const repository = Object.assign(
    MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() }),
    { revokeExpiredByName },
  );
  return { repository, revokeExpiredByName };
}

describe("the workflow run key sweep", () => {
  /** @scenario "The run's key stops working after the run ends" */
  it("asks for the reserved run-key name and the instant it read once, and counts the result", async () => {
    const { repository, revokeExpiredByName } = repositoryDouble(2);
    const now = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

    const count = await WorkflowRunKeyReapService.create({ repository, now: () => now }).reap();

    expect(count).toBe(2);
    expect(revokeExpiredByName).toHaveBeenCalledWith({
      name: "Workflow run",
      now,
      systemManagedOnly: true,
    });
  });
});
