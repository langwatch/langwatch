import { createLogger } from "@langwatch/observability";

import type { LwqlAccessModelOwner } from "../rules/langwatch-ql-config-store.rules.ts";

const logger = createLogger("langwatch:analytics:lwql:reconvergence");

export const LWQL_RECONVERGENCE_PROCESS_NAME = "lwqlReconvergence";

export interface LwqlReconvergenceRunDeps {
  /** Throws when ClickHouse is unreachable; the next wake probes again. */
  readonly probe: () => Promise<LwqlAccessModelOwner>;
  /** The whole self-provisioning run; logs and swallows its own failure. */
  readonly converge: () => Promise<void>;
}

/** Re-provisions only when neither the config store nor an app-owned model holds the identity. */
export function runLwqlReconvergence(
  deps: LwqlReconvergenceRunDeps,
): (payload: { final: boolean }) => Promise<void> {
  return async ({ final }): Promise<void> => {
    const owner = await deps.probe().catch((): LwqlAccessModelOwner => "config_store");
    if (owner === "config_store" && final) {
      logger.warn(
        "lwql reconvergence watch gave up: the ClickHouse config store still owns the LangWatchQL access model after the budget expired — the app-owned model stays yielded until the next boot",
      );
    }
    if (owner !== "none") return;
    // Awaited, never fired and forgotten: the worker's drain waits on this intent.
    await deps.converge();
  };
}
