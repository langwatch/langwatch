/**
 * Whether a save keeps fewer days than the period its scope resolved to before it, own rule or
 * inherited, so a later raise cannot read as applied over longer stamps.
 * @see modules/data-retention/specs/retention-apply-record.feature
 */
import { describe, expect, it } from "vitest";

import {
  createDataRetentionTestProjectScopes,
  retentionTestGraph,
} from "../../app/__tests__/data-retention.fixture.ts";
import { MemoryDataRetentionCacheRepository } from "../../repositories/memory/memory.data-retention-cache.repository.ts";
import { MemoryDataRetentionRepository } from "../../repositories/memory/memory.data-retention.repository.ts";
import { MemoryPinnedTraceRepository } from "../../repositories/memory/memory.pinned-trace.repository.ts";
import { MemoryRetroactiveRetentionRepository } from "../../repositories/memory/memory.retroactive-retention.repository.ts";
import { MemoryStorageMeterCacheRepository } from "../../repositories/memory/memory.storage-meter-cache.repository.ts";
import { MemoryStorageMeterRepository } from "../../repositories/memory/memory.storage-meter.repository.ts";
import { DataRetentionService } from "../data-retention.service.ts";
import { StorageMeterService } from "../storage-meter.service.ts";

const DEFAULT_DAYS = 91;
const ORGANIZATION = retentionTestGraph.organizationId ?? "organization-1";
const ORGANIZATION_SCOPE = { scopeType: "ORGANIZATION", scopeId: ORGANIZATION } as const;
const PROJECT_SCOPE = { scopeType: "PROJECT", scopeId: retentionTestGraph.projectId } as const;

function service() {
  return DataRetentionService.create({
    policies: MemoryDataRetentionRepository.create(),
    pins: MemoryPinnedTraceRepository.create(),
    projectScopes: createDataRetentionTestProjectScopes(),
    defaultRetentionDays: DEFAULT_DAYS,
    retroactive: MemoryRetroactiveRetentionRepository.create(),
    cache: MemoryDataRetentionCacheRepository.create(),
    storageMeter: StorageMeterService.create({
      meter: MemoryStorageMeterRepository.create(),
      cache: MemoryStorageMeterCacheRepository.create(),
    }),
  });
}

const save = (
  retention: DataRetentionService,
  scope: typeof ORGANIZATION_SCOPE | typeof PROJECT_SCOPE,
  retentionDays: number,
) =>
  retention.saveForScope({
    organizationId: ORGANIZATION,
    scope,
    category: "traces",
    retentionDays,
  });

describe("saveForScope", () => {
  describe("when a project's first override keeps fewer days than it inherited", () => {
    /** @scenario "A first override shorter than the period it inherited blocks a later raise" */
    it("answers that the save shortens", async () => {
      const retention = service();
      await save(retention, ORGANIZATION_SCOPE, 91);

      await expect(save(retention, PROJECT_SCOPE, 56)).resolves.toMatchObject({ shortens: true });
    });

    it("answers that a first organization rule below the platform default shortens", async () => {
      await expect(save(service(), ORGANIZATION_SCOPE, 56)).resolves.toMatchObject({
        shortens: true,
      });
    });
  });

  describe("when a first override keeps at least the inherited period", () => {
    it("answers that the save does not shorten", async () => {
      const retention = service();
      await save(retention, ORGANIZATION_SCOPE, 56);

      await expect(save(retention, PROJECT_SCOPE, 91)).resolves.toMatchObject({ shortens: false });
      await expect(save(service(), ORGANIZATION_SCOPE, DEFAULT_DAYS)).resolves.toMatchObject({
        shortens: false,
      });
    });
  });

  describe("when the scope's own rule is replaced", () => {
    it("compares with that rule, not with what the scope inherits", async () => {
      const retention = service();
      await save(retention, ORGANIZATION_SCOPE, 91);
      await save(retention, PROJECT_SCOPE, 182);

      await expect(save(retention, PROJECT_SCOPE, 119)).resolves.toMatchObject({ shortens: true });
      await expect(save(retention, PROJECT_SCOPE, 119)).resolves.toMatchObject({ shortens: false });
    });
  });
});
