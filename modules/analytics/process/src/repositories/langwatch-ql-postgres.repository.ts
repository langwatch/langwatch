/** Exactly the Postgres operations LangWatchQL provisioning performs. */
export type LwqlProvisioningDatabase = {
  $executeRawUnsafe: (statement: string) => Promise<number>;
  $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  $transaction: <T>(
    fn: (tx: { $executeRawUnsafe: (statement: string) => Promise<number> }) => Promise<T>,
    options: { timeout: number; maxWait: number },
  ) => Promise<T>;
};

/** One approved view PostgreSQL holds, and whether the reader role may select from it. */
export interface LwqlPostgresViewFound {
  readonly view: string;
  readonly granted: boolean;
}

/** The PostgreSQL side of LangWatchQL provisioning: the bridge statements and the boot lock. */
export abstract class LangWatchQLPostgresRepository {
  /** Runs catalog statements shared by every tenant, one at a time. */
  abstract runStatements(statements: readonly string[]): Promise<void>;
  /** The named views present in `schema`, and the reader's SELECT on each. */
  abstract findApprovedViews(input: {
    schema: string;
    role: string;
    views: readonly string[];
  }): Promise<LwqlPostgresViewFound[]>;
  /** Holds a transaction-scoped advisory lock on `key` while `fn` runs on other connections. */
  abstract withAdvisoryLock<T>(input: {
    key: string;
    timeoutMs: number;
    maxWaitMs: number;
    fn: () => Promise<T>;
  }): Promise<T>;
}
