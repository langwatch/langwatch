export const LICENSE_SYNC_PROCESS_NAME = "licenseSync";

/** Outbox rows are bookkeeping, one per sync, pruned like every recurring process's. */
const SYNC_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface LicenseSyncRunDeps {
  /** One pass over every organization with a license to sync; records each failure itself. */
  readonly sync: () => Promise<void>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/**
 * A pass that fails before reaching an organization throws, so the outbox
 * retries it and an operator sees it dead-lettered; the prune is bookkeeping,
 * and a failed one waits for the next day's.
 */
export function runLicenseSync(deps: LicenseSyncRunDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = deps.now();
    await deps.sync();
    await deps
      .deleteDispatchedBefore({
        processName: LICENSE_SYNC_PROCESS_NAME,
        before: startedAt - SYNC_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
