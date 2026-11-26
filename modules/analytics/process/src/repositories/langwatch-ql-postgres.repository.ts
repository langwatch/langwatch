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

/** One copy in the scoped schema, as the scoped-reader group finds it. */
interface LwqlScopedCopyFound {
  readonly view: string;
  readonly exists: boolean;
  /** A security barrier carrying the row scope, by the scoped-view check. */
  readonly passesGuard: boolean;
  /** The group holds USAGE on the scoped schema and SELECT on the copy. */
  readonly granted: boolean;
}

/** The scoped-reader group's reach: its schema, each copy, and any grant on a shared view. */
export interface LwqlScopedViewState {
  readonly groupExists: boolean;
  /** `owned`: its comment names this installation's app schema; `foreign`: any other comment. */
  readonly scopedSchema: "absent" | "owned" | "foreign";
  /** Shared approved views the group may select; empty without the group. */
  readonly groupOnShared: readonly string[];
  /** One per approved view; empty without the group. */
  readonly copies: readonly LwqlScopedCopyFound[];
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
  /** The scoped-reader `group`'s reach over `views`, shared in `appSchema` and copied. */
  abstract findScopedViewState(input: {
    appSchema: string;
    group: string;
    views: readonly string[];
  }): Promise<LwqlScopedViewState>;
  /** Holds a transaction-scoped advisory lock on `key` while `fn` runs on other connections. */
  abstract withAdvisoryLock<T>(input: {
    key: string;
    timeoutMs: number;
    maxWaitMs: number;
    fn: () => Promise<T>;
  }): Promise<T>;
}
