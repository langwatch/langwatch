import type { RetroactiveMutationProgress } from "./data-retention.ts";

export class ScopeTargetNotFoundError extends Error {
  readonly name = "ScopeTargetNotFoundError" as const;
}

export class RetroactiveMutationInProgressError extends Error {
  readonly name = "RetroactiveMutationInProgressError" as const;

  constructor(readonly blocked: RetroactiveMutationProgress[]) {
    const summary = blocked
      .map((mutation) => `${mutation.table} (${mutation.mutationId})`)
      .join(", ");
    super(
      `Retroactive update already in progress for: ${summary}. ` +
        "Wait for completion or kill the listed mutation(s) before starting another.",
    );
  }
}

export class DataRetentionBackendUnavailableError extends Error {
  readonly name = "DataRetentionBackendUnavailableError" as const;

  constructor() {
    super("ClickHouse not available");
  }
}
