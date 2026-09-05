/**
 * What provisioning LangWatchQL views involves beyond the view statements: grants, row policies, and run order.
 * @see ./langwatch-ql-view-statements.service.ts — the views
 * @see ./langwatch-ql-access-model.service.ts — the access model applied over them
 */
import { LWQL_VIEW_CATALOG, TENANT_COLUMN } from "../rules/lwql-view-catalog.rules";
import {
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
  type LangWatchQLTable,
} from "./langwatch-ql-access-model.service";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLDedupStrategy,
  type LangWatchQLViewDefinition,
} from "./langwatch-ql-catalog-shapes.service";
import { LangWatchQLViewStatementsService } from "./langwatch-ql-view-statements.service";

const accessModel = LangWatchQLAccessModelService.create();
const catalogShapes = LangWatchQLCatalogShapesService.create();
const viewStatements = LangWatchQLViewStatementsService.create();

/** The grants, row-policy sources and ordered setup list the views need. */
export class LangWatchQLViewProvisioningService {
  static create(): LangWatchQLViewProvisioningService {
    return new LangWatchQLViewProvisioningService();
  }

  private constructor() {}

  /**
   * The source tables the catalog reads, each with its tenant column, ready for a row policy.
   * Deduplicated by qualified name: two views over one table in one database share its policy,
   * and creating the same policy twice is not idempotent in a way worth relying on.
   */
  sourceTables({
    names,
    sourceDatabase,
    views = LWQL_VIEW_CATALOG,
  }: {
    names: LangWatchQLNames;
    sourceDatabase: string;
    views?: readonly LangWatchQLViewDefinition[];
  }): LangWatchQLTable[] {
    const byTable = new Map<string, LangWatchQLTable>();
    for (const view of views) {
      // A PostgreSQL-engine table lives in the LangWatchQL database, beside the
      // view over it, rather than in the application's.
      const database = catalogShapes.isPostgresResident(view) ? names.database : sourceDatabase;
      // Keyed on the qualified name, not the bare table. Two catalog entries can share a
      // `sourceTable` while resolving to different databases — one PostgreSQL-resident, one a
      // fact table — and keying on the bare name collapses them to a single entry. The one that
      // loses gets no row policy, and the row policy is the tenant boundary, so the physical
      // table becomes readable across tenants by the restricted identity.
      byTable.set(`${database}.${view.sourceTable}`, {
        table: view.sourceTable,
        // Every source names the owning project the same way — the fact tables
        // because that is their column, the PostgreSQL-engine tables because the
        // approved view renamed the application's `projectId` to match. The
        // catalog would have to grow a per-view tenant column if that ever
        // stopped being true; today asserting it here is what would catch it.
        tenantColumn: TENANT_COLUMN,
        database,
      });
    }

    return [...byTable.values()];
  }

  /**
   * Every statement that provisions the LangWatchQL views, in dependency order.
   */
  setupStatements({
    names,
    sourceDatabase,
    views = LWQL_VIEW_CATALOG,
    dedup,
  }: {
    names: LangWatchQLNames;
    sourceDatabase: string;
    views?: readonly LangWatchQLViewDefinition[];
    dedup: LangWatchQLDedupStrategy;
  }): string[] {
    return [
      ...views.map((view) => viewStatements.viewStatement({ names, sourceDatabase, view, dedup })),
      // A fact table carries far more than the catalog exposes, so its grant is column-scoped.
      // A PostgreSQL-engine table was *created from* the catalog and its whole column list is
      // the exposed surface, so it takes the whole-object grant the key map and the views take
      // — which is also what keeps `SHOW CREATE TABLE` answerable, the surface the
      // credential-leak assertion inspects.
      ...views.map((view) =>
        catalogShapes.isPostgresResident(view)
          ? accessModel.grantStatement({ names, table: view.sourceTable })
          : viewStatements.sourceColumnGrantStatement({ names, sourceDatabase, view }),
      ),
      ...views.map((view) => accessModel.grantStatement({ names, table: view.name })),
      ...this.sourceTables({ names, sourceDatabase, views }).map((lwqlTable) =>
        accessModel.rowPolicyStatement({ names, lwqlTable }),
      ),
    ];
  }
}
