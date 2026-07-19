import type { ResolvedRetention } from "../../data-retention/retentionPolicy.schema";
import type { Projection } from "../domain/types";
import type {
  ProjectionStore,
} from "../stores/projectionStore.types";
import type { FoldProjectionStore } from "./foldProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

/** Treats absent and null retention as equal (both mean indefinite). */
function sameRetention(
  a: ResolvedRetention | null | undefined,
  b: ResolvedRetention | null | undefined,
): boolean {
  return (
    (a?.traces ?? null) === (b?.traces ?? null) &&
    (a?.scenarios ?? null) === (b?.scenarios ?? null) &&
    (a?.experiments ?? null) === (b?.experiments ?? null)
  );
}

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

    await this.repo.storeProjection(projection, {
      tenantId: context.tenantId,
      metadata: context.retentionPolicy
        ? { retentionPolicy: context.retentionPolicy }
        : undefined,
    });
  }

  async storeBatch(
    entries: Array<{ state: TData; context: ProjectionStoreContext }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const firstContext = entries[0]!.context;

    // The native batch insert stamps ONE tenantId + retentionPolicy onto every
    // row, so it's only correct when the batch is uniform. Callers group by
    // tenant today, but guard regardless: a mixed batch must fall back to
    // per-entry writes rather than silently tagging later rows with the first
    // entry's tenant/retention (a multitenancy + retention correctness hazard).
    if (this.repo.storeProjectionBatch && this.isUniformContext(entries)) {
      const projections = entries.map((entry) => ({
        id: entry.context.aggregateId,
        aggregateId: entry.context.aggregateId,
        tenantId: entry.context.tenantId,
        version: this.version,
        data: entry.state,
      }));
      await this.repo.storeProjectionBatch(projections, {
        tenantId: firstContext.tenantId,
        metadata: firstContext.retentionPolicy
          ? { retentionPolicy: firstContext.retentionPolicy }
          : undefined,
      });
      return;
    }

    // Fallback: sequential store calls (also the mixed-context safe path).
    for (const entry of entries) {
      await this.store(entry.state, entry.context);
    }
  }

  private isUniformContext(
    entries: Array<{ context: ProjectionStoreContext }>,
  ): boolean {
    const first = entries[0]!.context;
    return entries.every(
      (entry) =>
        entry.context.tenantId === first.tenantId &&
        sameRetention(entry.context.retentionPolicy, first.retentionPolicy),
    );
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
