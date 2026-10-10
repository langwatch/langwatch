/**
 * LangWatchQL access model — the one typed, side-effect-free definition.
 *
 * Issue #8258 makes the app the single owner of the LWQL access model and
 * delivers it two ways: as SQL DDL (BYO ClickHouse, {@link ./accessModelDdl.ts})
 * and as per-pod `users.d` / `config.d` config (chart, SaaS,
 * {@link ./accessModelUsersConfig.ts}). Both read *this* definition and compute
 * nothing themselves, so the two can never drift — a parity test proves they
 * name the identical user, profile, grants, row policies and named-collection
 * fields (AC6).
 *
 * The definition is pure data: the restricted user with the sha256 hex of its
 * password (never the plaintext — AC5), the settings profile with its settings
 * and per-setting constraints, the grant set derived from the catalog, both
 * row policies with their predicates, the PostgreSQL named-collection fields,
 * and the `custom_` settings prefix. The grant and policy sets are composed with
 * the same catalog helpers the shipped DDL uses (`catalogStatements.ts`), so the
 * definition is provably the shipped model rather than a second description of
 * it (see `__tests__/accessModelParity.unit.test.ts`).
 *
 * @see ./accessModelDdl.ts — the SQL DDL emitter over this definition
 * @see ./accessModelUsersConfig.ts — the users.d / config.d YAML emitter
 * @see specs/lwql/access-model.feature
 */

import { LWQL_VIEW_CATALOG } from "../catalog/lwqlViews";
import {
  isPostgresResident,
  type LangWatchQLViewDefinition,
} from "../catalog/types";
import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  type LangWatchQLResourceLimits,
} from "../limits";
import type { LangWatchQLNames } from "./accessModel";
import {
  lwqlKeyMapPolicyName,
  lwqlKeyMapSelfFilter,
  lwqlProfileSettings,
  lwqlRowPolicyName,
  lwqlTenantPredicate,
} from "./accessModelDdl";
import {
  lwqlGrantedSourceColumns,
  lwqlSourceTables,
} from "./catalogStatements";
import type { PostgresNamedCollection } from "./postgresMapping";

/** The `custom_` settings prefix a LangWatchQL deployment declares server-side. */
export const LWQL_CUSTOM_SETTINGS_PREFIX = "custom_";

/** One setting of the restricted profile, with the constraint pinning it. */
export interface LwqlProfileSetting {
  /** Setting name, e.g. `readonly` or the tenant capability setting. */
  readonly name: string;
  /** The value the profile sets. A number, or a string for a quoted value. */
  readonly value: string | number;
  /** Whether the DDL renders the value as a quoted string literal. */
  readonly quoted?: boolean;
  /**
   * How the profile pins the setting under `readonly = 1`. Every ceiling is
   * `const`; only the tenant capability is `changeable_in_readonly`.
   */
  readonly constraint: "const" | "changeable_in_readonly";
}

/** A `SELECT` grant: whole-object, or column-scoped when `columns` is set. */
export interface LwqlGrantTarget {
  readonly database: string;
  readonly table: string;
  /** Column list for a column-scoped grant; absent means a whole-object grant. */
  readonly columns?: readonly string[];
}

/** A row policy: the tenant/self predicate bound to one table. */
export interface LwqlRowPolicyTarget {
  /** Policy name, as the DDL names it (`<table>_tenant` / `<keyMap>_self`). */
  readonly name: string;
  readonly database: string;
  readonly table: string;
  /** The `USING` predicate expression. */
  readonly predicate: string;
}

/** The whole LangWatchQL access model, as data both emitters render. */
export interface LwqlAccessModelDefinition {
  readonly customSettingsPrefix: string;
  readonly user: { readonly name: string; readonly passwordSha256Hex: string };
  readonly profile: {
    readonly name: string;
    readonly settings: readonly LwqlProfileSetting[];
  };
  readonly grants: readonly LwqlGrantTarget[];
  readonly rowPolicies: readonly LwqlRowPolicyTarget[];
  readonly namedCollection: PostgresNamedCollection;
}

/** The grant set, composed with the same catalog helpers the shipped DDL uses. */
function accessModelGrants({
  names,
  sourceDatabase,
  views,
}: {
  names: LangWatchQLNames;
  sourceDatabase: string;
  views: readonly LangWatchQLViewDefinition[];
}): LwqlGrantTarget[] {
  const grants: LwqlGrantTarget[] = [
    { database: sourceDatabase, table: names.keyMapTable },
  ];
  // Source-table grants: a PostgreSQL-engine table's whole column list is the
  // exposed surface, so it takes a whole-object grant; a fact table carries far
  // more than the catalog exposes, so it is column-scoped.
  for (const view of views) {
    grants.push(
      isPostgresResident(view)
        ? { database: names.database, table: view.sourceTable }
        : {
            database: sourceDatabase,
            table: view.sourceTable,
            columns: [...lwqlGrantedSourceColumns(view)],
          },
    );
  }
  // The joined side of a two-table view: an INVOKER view reads it as the caller
  // too, so the caller must hold a grant on every column the join reads.
  for (const view of views) {
    if (!view.join) continue;
    grants.push({
      database: sourceDatabase,
      table: view.join.table,
      columns: [
        ...new Set([
          ...view.join.sourceColumns,
          ...(view.join.onSourceColumns?.joined ?? []),
        ]),
      ],
    });
  }
  // The views themselves.
  for (const view of views) {
    grants.push({ database: names.database, table: view.name });
  }
  return grants;
}

/** Both row policies: the key map's self filter, and one tenant policy per source table. */
function accessModelRowPolicies({
  names,
  sourceDatabase,
  views,
}: {
  names: LangWatchQLNames;
  sourceDatabase: string;
  views: readonly LangWatchQLViewDefinition[];
}): LwqlRowPolicyTarget[] {
  const keyMapPolicy: LwqlRowPolicyTarget = {
    name: lwqlKeyMapPolicyName(names.keyMapTable),
    database: sourceDatabase,
    table: names.keyMapTable,
    predicate: lwqlKeyMapSelfFilter(names),
  };
  const tablePolicies = lwqlSourceTables({ names, sourceDatabase, views }).map(
    (table): LwqlRowPolicyTarget => ({
      name: lwqlRowPolicyName(table.table),
      database: table.database ?? names.database,
      table: table.table,
      predicate: lwqlTenantPredicate({
        names,
        tenantColumn: table.tenantColumn,
        sourceDatabase,
      }),
    }),
  );
  return [keyMapPolicy, ...tablePolicies];
}

/**
 * Builds the whole access-model definition for a deployment. Side-effect-free:
 * every input is a parameter and the output is data, so both emitters and the
 * parity test consume the same object with no I/O.
 *
 * `passwordSha256Hex` is the sha256 hex of the restricted user's password, never
 * the password itself (AC5). `sourceDatabase` is the app's own ClickHouse
 * database (the key map and fact tables live there); for a self-provisioned
 * deployment it equals `names.database`.
 */
export function buildLwqlAccessModelDefinition({
  names,
  passwordSha256Hex,
  namedCollection,
  sourceDatabase,
  limits = DEFAULT_LWQL_RESOURCE_LIMITS,
  views = LWQL_VIEW_CATALOG,
}: {
  names: LangWatchQLNames;
  passwordSha256Hex: string;
  namedCollection: PostgresNamedCollection;
  sourceDatabase: string;
  limits?: LangWatchQLResourceLimits;
  views?: readonly LangWatchQLViewDefinition[];
}): LwqlAccessModelDefinition {
  return {
    customSettingsPrefix: LWQL_CUSTOM_SETTINGS_PREFIX,
    user: { name: names.restrictedUser, passwordSha256Hex },
    profile: {
      name: names.settingsProfile,
      settings: lwqlProfileSettings({ names, limits }),
    },
    grants: accessModelGrants({ names, sourceDatabase, views }),
    rowPolicies: accessModelRowPolicies({ names, sourceDatabase, views }),
    namedCollection,
  };
}
