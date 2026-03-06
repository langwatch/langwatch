import { describe, it, expect, vi } from "vitest";
import { createSuiteRunItemsFoldStore } from "../suiteRunItems.store";
import type { SuiteRunItemData } from "../suiteRunItems.foldProjection";
import type { SuiteRunItemsRepository } from "../../repositories/suiteRunItems.repository";
import type { TenantId } from "../../../../domain/tenantId";

function makeItem(overrides: Partial<SuiteRunItemData> = {}): SuiteRunItemData {
  return {
    ScenarioRunId: "sr-1",
    ScenarioId: "s1",
    TargetReferenceId: "t1",
    TargetType: "http",
    Status: "IN_PROGRESS",
    Verdict: null,
    DurationMs: null,
    StartedAt: 1000,
    FinishedAt: null,
    UpdatedAt: 2000,
    ...overrides,
  };
}

describe("suiteRunItems fold store", () => {
  describe("when getting items", () => {
    it("assembles rows into items map", async () => {
      const item1 = makeItem({ ScenarioRunId: "sr-1" });
      const item2 = makeItem({ ScenarioRunId: "sr-2", ScenarioId: "s2" });

      const repository: SuiteRunItemsRepository = {
        getItems: vi.fn().mockResolvedValue([item1, item2]),
        storeItems: vi.fn(),
      };

      const store = createSuiteRunItemsFoldStore(repository);
      const result = await store.get("suite1:batch1", {
        aggregateId: "suite1:batch1",
        tenantId: "tenant-1" as TenantId,
      });

      expect(result).not.toBeNull();
      expect(Object.keys(result!.items)).toHaveLength(2);
      expect(result!.items["sr-1"]).toEqual(item1);
      expect(result!.items["sr-2"]).toEqual(item2);
    });

    it("returns null when no rows found", async () => {
      const repository: SuiteRunItemsRepository = {
        getItems: vi.fn().mockResolvedValue([]),
        storeItems: vi.fn(),
      };

      const store = createSuiteRunItemsFoldStore(repository);
      const result = await store.get("suite1:batch1", {
        aggregateId: "suite1:batch1",
        tenantId: "tenant-1" as TenantId,
      });

      expect(result).toBeNull();
    });
  });

  describe("when storing items", () => {
    it("writes all items as individual rows", async () => {
      const item1 = makeItem({ ScenarioRunId: "sr-1" });
      const item2 = makeItem({ ScenarioRunId: "sr-2" });

      const repository: SuiteRunItemsRepository = {
        getItems: vi.fn(),
        storeItems: vi.fn(),
      };

      const store = createSuiteRunItemsFoldStore(repository);
      await store.store(
        { items: { "sr-1": item1, "sr-2": item2 } },
        { aggregateId: "suite1:batch1", tenantId: "tenant-1" as TenantId },
      );

      expect(repository.storeItems).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        suiteId: "suite1",
        batchRunId: "batch1",
        projectionId: "suite1:batch1",
        items: expect.arrayContaining([item1, item2]),
      });
    });
  });
});
