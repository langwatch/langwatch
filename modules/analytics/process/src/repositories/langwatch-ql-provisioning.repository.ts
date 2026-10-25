import type {
  ConfigStoreLwqlEntity,
  LwqlAccessModelIdentity,
  LwqlAccessModelOwner,
} from "../rules/langwatch-ql-config-store.rules.ts";

/** The collections a server holds and each PostgreSQL engine table's binding. */
export interface LwqlCollectionState {
  readonly available: readonly string[];
  readonly bound: Readonly<Record<string, string>>;
}

/** One key-map row: a project's key hash and the project it resolves to. */
export interface LwqlKeyMapInsertRow {
  readonly KeyHash: string;
  readonly TenantId: string;
}

export interface SkippedProvisioningStatement {
  /** 1-based position in the batch. */
  readonly index: number;
  readonly code: number;
  readonly kind: string;
}

export interface RunClickHouseStatementsResult {
  readonly skipped: SkippedProvisioningStatement[];
}

/** How loudly a failed statement is logged: `warn` where a later check retries it. */
export type ProvisioningFailureLevel = "error" | "warn";

/** The named tables, views and SQL functions the server holds now. */
export interface LwqlClickHouseInventory {
  /** Each named table or view present. */
  readonly relations: readonly string[];
  /** The named SQL user-defined functions present. */
  readonly functions: readonly string[];
}

/**
 * Untenanted statements on the shared server, restated from the stores' `clickhouseAdmin`
 * member so this module depends on no framework package (ADR-159).
 */
export interface ClickHouseAdminStatements {
  command(statement: string): Promise<void>;
  rows(sql: string, params?: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>[]>;
  insert(input: {
    table: string;
    rows: readonly Readonly<Record<string, unknown>>[];
    settings?: Readonly<Record<string, string | number>>;
  }): Promise<void>;
}

/** The admin ClickHouse the access model is provisioned on, over one connection per run. */
export abstract class LangWatchQLProvisioningRepository {
  abstract runStatements(input: {
    statements: readonly string[];
    configStoreEntities?: readonly ConfigStoreLwqlEntity[];
    failureLevel?: ProvisioningFailureLevel;
  }): Promise<RunClickHouseStatementsResult>;
  /** Two catalog reads; throws when ClickHouse is unreachable. */
  abstract readInventory(input: {
    database: string;
    relations: readonly string[];
    functions: readonly string[];
  }): Promise<LwqlClickHouseInventory>;
  /** Which candidate collections exist and each engine table's binding; empty where unreadable. */
  abstract readCollectionState(input: {
    database: string;
    candidates: readonly string[];
  }): Promise<LwqlCollectionState>;
  abstract inventoryConfigStore(input: {
    names: LwqlAccessModelIdentity;
  }): Promise<ConfigStoreLwqlEntity[]>;
  abstract probeOwner(input: { names: LwqlAccessModelIdentity }): Promise<LwqlAccessModelOwner>;
  abstract queryRows(sql: string): Promise<Record<string, unknown>[]>;
  abstract findKeyMapHashes(input: { table: string; tenantId: string }): Promise<string[]>;
  abstract insertKeyMapRows(input: {
    table: string;
    rows: readonly LwqlKeyMapInsertRow[];
  }): Promise<void>;
  abstract close(): Promise<void>;
}
