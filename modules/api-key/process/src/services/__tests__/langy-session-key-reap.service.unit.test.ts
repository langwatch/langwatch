/**
 * What the Langy session-key sweep may touch: the reserved name and the clock, once.
 * Spec: modules/api-key/specs/api-key.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRepository } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { LangySessionKeyReapService } from "../langy-session-key-reap.service.ts";

function repositoryDouble(count = 0) {
  const revokeExpiredByName = vi.fn<ApiKeyRepository["revokeExpiredByName"]>(async () => count);
  const repository = Object.assign(
    MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() }),
    { revokeExpiredByName },
  );
  return { repository, revokeExpiredByName };
}

describe("the Langy session key sweep", () => {
  /** @scenario "The sweep retires elapsed Langy session keys" */
  it("asks for the reserved Langy session name and the instant it read once, and counts the result", async () => {
    const { repository, revokeExpiredByName } = repositoryDouble(3);
    const now = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

    const count = await LangySessionKeyReapService.create({ repository, now: () => now }).reap();

    expect(count).toBe(3);
    expect(revokeExpiredByName).toHaveBeenCalledWith({ name: "Langy session", now });
  });
});
