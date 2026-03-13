import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type {
  SuiteRunState,
  SuiteRunStateData,
} from "./suiteRunState.foldProjection";
import { SUITE_RUN_PROJECTION_VERSIONS } from "../schemas/constants";
import type { SuiteRunStateRepository } from "../repositories/suiteRunState.repository";

/**
 * Creates a FoldProjectionStore for suite run state.
 * Dumb read/write — state IS the data.
 */
export function createSuiteRunStateFoldStore(
  repository: SuiteRunStateRepository,
): FoldProjectionStore<SuiteRunStateData> {
  return {
    async store(
      state: SuiteRunStateData,
      context: ProjectionStoreContext,
    ): Promise<void> {
      const projectionId = context.aggregateId;

      const projection: SuiteRunState = {
        id: projectionId,
        aggregateId: context.aggregateId,
        tenantId: context.tenantId,
        version: SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE,
        data: state,
      };

      await repository.storeProjection(projection, { tenantId: context.tenantId });
    },

    async get(
      aggregateId: string,
      context: ProjectionStoreContext,
    ): Promise<SuiteRunStateData | null> {
      const projection = await repository.getProjection(aggregateId, {
        tenantId: context.tenantId,
      });

      return (projection?.data as SuiteRunStateData) ?? null;
    },
  };
}
