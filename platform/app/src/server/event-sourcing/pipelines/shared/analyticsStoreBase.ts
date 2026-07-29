import type {
  ResolvedRetention,
  RetentionCategory,
} from "~/server/data-retention/retentionPolicy.schema";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../projections/projectionStoreContext";

/**
 * Shared base class for the ADR-034 analytics rollup projection stores: look
 * up per-tenant retention on the context and delegate the append to the
 * repository, so a concrete store is a config wrapper naming only its
 * retention category.
 *
 * The slim-side counterpart (`BaseAnalyticsFoldStore`) lived here too and was
 * deleted once its last adopter moved to the ADR-066 read-back shape. Its
 * `get` returned `null`, which is the pattern ADR-066 exists to retire.
 */

interface RollupSideRepo<TRow> {
  insertRow(row: TRow, retentionDays?: number): Promise<void>;
}

/**
 * The retention day-count a projection store stamps on the rows it writes.
 *
 * The single derivation for every store: read the tenant's resolved policy for
 * the category the store's table belongs to (see `RETENTION_TABLE_CATEGORY_MAP`)
 * and fall back to the platform default when no policy reached this write.
 * Retention is default-on, so the fallback is a real day count and never
 * "indefinite" — leaving it to the ClickHouse column default would silently
 * grandfather new rows onto `MIGRATION_DEFAULT_RETENTION_DAYS`.
 *
 * Takes the narrowest context it needs so it serves both `ProjectionStoreContext`
 * (single append) and `BulkAppendContext` (replay's chunked writes).
 */
export function retentionDaysFrom(
  context: { retentionPolicy?: ResolvedRetention | null },
  category: RetentionCategory,
): number {
  return context.retentionPolicy?.[category] ?? PLATFORM_DEFAULT_RETENTION_DAYS;
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

  async append(record: TRow, context: ProjectionStoreContext): Promise<void> {
    const retentionDays = retentionDaysFrom(
      context,
      this.config.retentionCategory,
    );
    await this.repo.insertRow(record, retentionDays);
  }
}
