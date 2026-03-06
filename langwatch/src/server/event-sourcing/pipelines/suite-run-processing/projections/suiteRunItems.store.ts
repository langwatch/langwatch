import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { SuiteRunItemData, SuiteRunItemsData } from "./suiteRunItems.foldProjection";
import type { SuiteRunItemsRepository } from "../repositories/suiteRunItems.repository";
import { parseSuiteRunKey } from "../utils/compositeKey";

/**
 * Creates a FoldProjectionStore for suite run items.
 *
 * Bridges between fold state (single object with all items keyed by scenarioRunId)
 * and CH storage (individual rows). On get, assembles rows into the items map.
 * On store, writes all items as individual rows (ReplacingMergeTree deduplicates).
 */
export function createSuiteRunItemsFoldStore(
  repository: SuiteRunItemsRepository,
): FoldProjectionStore<SuiteRunItemsData> {
  return {
    async store(
      state: SuiteRunItemsData,
      context: ProjectionStoreContext,
    ): Promise<void> {
      const { suiteId, batchRunId } = parseSuiteRunKey(context.aggregateId);
      const items = Object.values(state.items);

      await repository.storeItems({
        tenantId: String(context.tenantId),
        suiteId,
        batchRunId,
        projectionId: context.aggregateId,
        items,
      });
    },

    async get(
      aggregateId: string,
      context: ProjectionStoreContext,
    ): Promise<SuiteRunItemsData | null> {
      const { suiteId, batchRunId } = parseSuiteRunKey(aggregateId);
      const rows = await repository.getItems({
        tenantId: String(context.tenantId),
        suiteId,
        batchRunId,
      });

      if (rows.length === 0) return null;

      const items: Record<string, SuiteRunItemData> = {};
      for (const row of rows) {
        items[row.ScenarioRunId] = row;
      }

      return { items };
    },
  };
}
