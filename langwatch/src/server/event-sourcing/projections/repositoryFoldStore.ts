import type { Projection } from "../domain/types";
import type {
  ProjectionStore,
} from "../stores/projectionStore.types";
import type { FoldProjectionStore } from "./foldProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

/**
 * Generic adapter that wraps a ProjectionStore (repository) into a FoldProjectionStore.
 *
 * Replaces per-pipeline boilerplate store factories (e.g., createSuiteRunStateFoldStore,
 * createSimulationRunStateFoldStore) that all do the same thing: wrap data into a Projection
 * envelope on write, extract data on read.
 *
 * Accepts `ProjectionStore<Projection>` (untyped data) because existing repository
 * implementations default to `Projection` without a data type parameter.
 * The data is cast at the boundary — same as the factories this replaces.
 *
 * @example
 * ```typescript
 * const store = new RepositoryFoldStore<SuiteRunStateData>(
 *   suiteRunStateRepo,
 *   SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE,
 * );
 * ```
 */
export class RepositoryFoldStore<TData>
  implements FoldProjectionStore<TData>
{
  constructor(
    private readonly repo: ProjectionStore<Projection>,
    private readonly version: string,
  ) {}

  async store(state: TData, context: ProjectionStoreContext): Promise<void> {
    const projection: Projection = {
      id: context.aggregateId,
      aggregateId: context.aggregateId,
      tenantId: context.tenantId,
      version: this.version,
      data: state,
    };

    await this.repo.storeProjection(projection, { tenantId: context.tenantId });
  }

  async storeBatch(
    entries: Array<{ state: TData; context: ProjectionStoreContext }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    // Use native batch insert if the repository supports it
    if (this.repo.storeProjectionBatch) {
      const projections = entries.map((entry) => ({
        id: entry.context.aggregateId,
        aggregateId: entry.context.aggregateId,
        tenantId: entry.context.tenantId,
        version: this.version,
        data: entry.state,
      }));
      await this.repo.storeProjectionBatch(projections, {
        tenantId: entries[0]!.context.tenantId,
      });
      return;
    }

    // Fallback: sequential store calls
    for (const entry of entries) {
      await this.store(entry.state, entry.context);
    }
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<TData | null> {
    const projection = await this.repo.getProjection(aggregateId, {
      tenantId: context.tenantId,
    });

    return (projection?.data as TData) ?? null;
  }
}
