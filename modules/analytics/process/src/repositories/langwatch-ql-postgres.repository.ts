/** Exactly the Postgres operations LangWatchQL provisioning performs. */
export type LwqlProvisioningDatabase = {
  $executeRawUnsafe: (statement: string) => Promise<number>;
  $transaction: <T>(
    fn: (tx: { $executeRawUnsafe: (statement: string) => Promise<number> }) => Promise<T>,
    options: { timeout: number; maxWait: number },
  ) => Promise<T>;
};

/** The PostgreSQL side of LangWatchQL provisioning: the bridge statements and the boot lock. */
export abstract class LangWatchQLPostgresRepository {
  /** Runs catalog statements shared by every tenant, one at a time. */
  abstract runStatements(statements: readonly string[]): Promise<void>;
  /** Holds a transaction-scoped advisory lock on `key` while `fn` runs on other connections. */
  abstract withAdvisoryLock<T>(input: {
    key: string;
    timeoutMs: number;
    maxWaitMs: number;
    fn: () => Promise<T>;
  }): Promise<T>;
}
