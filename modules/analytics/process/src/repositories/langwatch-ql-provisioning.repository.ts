import type {
  ConfigStoreLwqlEntity,
  LwqlAccessModelIdentity,
  LwqlAccessModelOwner,
} from "../rules/langwatch-ql-config-store.rules.ts";

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
  }): Promise<RunClickHouseStatementsResult>;
  abstract inventoryConfigStore(input: {
    names: LwqlAccessModelIdentity;
  }): Promise<ConfigStoreLwqlEntity[]>;
  abstract probeOwner(input: { names: LwqlAccessModelIdentity }): Promise<LwqlAccessModelOwner>;
  abstract queryRows(sql: string): Promise<Record<string, unknown>[]>;
  abstract findKeyMapHashes(input: { table: string }): Promise<string[]>;
  abstract insertKeyMapRows(input: {
    table: string;
    rows: readonly LwqlKeyMapInsertRow[];
  }): Promise<void>;
  abstract close(): Promise<void>;
}
