import type { Projection } from "../domain/types.ts";
import type { RetentionPolicy } from "../runtime.types.ts";
import type { ProjectionStore } from "../stores/projectionStore.types.ts";
import type { FoldProjectionStore, FoldStateRead } from "./foldProjection.types.ts";
import type { ProjectionStoreContext } from "./projectionStoreContext.ts";

/** Treats absent and null retention as equal (both mean indefinite). */
function sameRetention(
  a: RetentionPolicy | null | undefined,
  b: RetentionPolicy | null | undefined,
): boolean {
  return (
    (a?.traces ?? null) === (b?.traces ?? null) &&
    (a?.scenarios ?? null) === (b?.scenarios ?? null) &&
    (a?.experiments ?? null) === (b?.experiments ?? null)
  );
}

/** Generic adapter that wraps a ProjectionStore into a FoldProjectionStore. */
export class RepositoryFoldStore<TData> implements FoldProjectionStore<TData> {
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
      metadata: context.retentionPolicy ? { retentionPolicy: context.retentionPolicy } : undefined,
    });
  }

  async storeBatch(entries: { state: TData; context: ProjectionStoreContext }[]): Promise<void> {
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

  private isUniformContext(entries: { context: ProjectionStoreContext }[]): boolean {
    const first = entries[0]!.context;
    return entries.every(
      (entry) =>
        entry.context.tenantId === first.tenantId &&
        sameRetention(entry.context.retentionPolicy, first.retentionPolicy),
    );
  }

  async get(aggregateId: string, context: ProjectionStoreContext): Promise<FoldStateRead<TData>> {
    const projection = await this.repo.findProjection(aggregateId, {
      tenantId: context.tenantId,
    });
    if (!projection) return { kind: "empty" };

    return { kind: "folded", state: projection.data as TData };
  }
}
