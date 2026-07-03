import type { RetentionCategory } from "~/server/data-retention/retentionPolicy.schema";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../projections/projectionStoreContext";

/**
 * Shared base classes for the ADR-034 analytics projection stores. The 8
 * concrete stores (evaluation / experiment / simulation / suite × slim +
 * rollup) all follow the same pattern — filter empty rows, stamp the
 * aggregateId as a fallback for the identity column, look up per-tenant
 * retention on the context, project the state to the CH row shape, and
 * delegate to the repository. Only the identity column, the retention
 * category, and the projection function vary per aggregate.
 *
 * Consolidating here (s5014-002) — the per-aggregate concrete class shrinks
 * to a ~15 LOC config wrapper.
 */

interface SlimSideRepo<TRow> {
  upsert(row: TRow, retentionDays?: number): Promise<void>;
  upsertBatch?(
    entries: Array<{ row: TRow; retentionDays?: number }>,
  ): Promise<void>;
}

interface RollupSideRepo<TRow> {
  insertRow(row: TRow, retentionDays?: number): Promise<void>;
  insertRows(rows: TRow[], retentionDays?: number): Promise<void>;
}

interface SlimFoldStoreConfig<TState, TRow> {
  /**
   * Guards `store`/`storeBatch` — the fold may have fired with a half-formed
   * state (e.g. scheduled-only, no terminal signal). Returning false makes
   * the store a no-op so the slim table never holds phantom rows. The
   * context is passed through so aggregates that identify themselves via
   * the framework aggregateId (rather than an in-state field) can bail out
   * cleanly when neither is set.
   */
  hasPersistableSignal: (
    state: TState,
    context: ProjectionStoreContext,
  ) => boolean;
  /**
   * When the state hasn't stamped its own identity column yet, fall back
   * to the aggregate id from the store context. Returns a NEW state
   * object; the caller must not mutate the input.
   */
  stampAggregateId: (state: TState, aggregateId: string) => TState;
  /** Retention category to consult on the context (`traces` / `evaluations` / ...). */
  retentionCategory: RetentionCategory;
  /** Schema-version stamp written on the row (aggregate-specific constant). */
  versionLatest: string;
  /** Projection function that materialises the row from the fold state. */
  project: (params: {
    state: TState;
    tenantId: string;
    version: string;
  }) => TRow;
}

function retentionDaysFrom(
  context: ProjectionStoreContext,
  category: RetentionCategory,
): number {
  return (
    context.retentionPolicy?.[category] ?? PLATFORM_DEFAULT_RETENTION_DAYS
  );
}

/**
 * Slim-projection base class — implements `store` (single row) +
 * `storeBatch` (N rows with per-row retention). Concrete classes provide
 * the aggregate-specific config via `super(...)`.
 *
 * `get` returns `null` for every aggregate we've shipped so far (Phase 2/3
 * contract — the executor re-folds from the event log on slim cache miss
 * rather than reading slim back). Override in a subclass if a future
 * aggregate genuinely needs a read-back path.
 */
export abstract class BaseAnalyticsFoldStore<TState, TRow>
  implements FoldProjectionStore<TState>
{
  protected readonly repo: SlimSideRepo<TRow>;
  protected readonly config: SlimFoldStoreConfig<TState, TRow>;

  constructor(
    repo: SlimSideRepo<TRow>,
    config: SlimFoldStoreConfig<TState, TRow>,
  ) {
    this.repo = repo;
    this.config = config;
  }

  async store(
    state: TState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (!this.config.hasPersistableSignal(state, context)) return;
    const stateWithId = this.config.stampAggregateId(
      state,
      String(context.aggregateId),
    );
    const row = this.config.project({
      state: stateWithId,
      tenantId: String(context.tenantId),
      version: this.config.versionLatest,
    });
    await this.repo.upsert(
      row,
      retentionDaysFrom(context, this.config.retentionCategory),
    );
  }

  async storeBatch(
    entries: Array<{ state: TState; context: ProjectionStoreContext }>,
  ): Promise<void> {
    const batchRows = entries
      .filter(({ state, context }) =>
        this.config.hasPersistableSignal(state, context),
      )
      .map(({ state, context }) => {
        const stateWithId = this.config.stampAggregateId(
          state,
          String(context.aggregateId),
        );
        return {
          row: this.config.project({
            state: stateWithId,
            tenantId: String(context.tenantId),
            version: this.config.versionLatest,
          }),
          retentionDays: retentionDaysFrom(
            context,
            this.config.retentionCategory,
          ),
        };
      });

    if (batchRows.length === 0) return;

    if (this.repo.upsertBatch) {
      await this.repo.upsertBatch(batchRows);
    } else {
      await Promise.all(
        batchRows.map(({ row, retentionDays }) =>
          this.repo.upsert(row, retentionDays),
        ),
      );
    }
  }

  async get(
    _aggregateId: string,
    _context: ProjectionStoreContext,
  ): Promise<TState | null> {
    return null;
  }
}

interface RollupAppendStoreConfig {
  retentionCategory: RetentionCategory;
}

/**
 * Rollup-projection base class — implements `append` (fire-and-forget
 * insert of one increment row). Concrete stores provide only the retention
 * category via `super(...)`.
 */
export abstract class BaseAnalyticsRollupAppendStore<TRow>
  implements AppendStore<TRow>
{
  protected readonly repo: RollupSideRepo<TRow>;
  protected readonly config: RollupAppendStoreConfig;

  constructor(repo: RollupSideRepo<TRow>, config: RollupAppendStoreConfig) {
    this.repo = repo;
    this.config = config;
  }

  async append(
    record: TRow,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const retentionDays = retentionDaysFrom(
      context,
      this.config.retentionCategory,
    );
    await this.repo.insertRow(record, retentionDays);
  }
}
