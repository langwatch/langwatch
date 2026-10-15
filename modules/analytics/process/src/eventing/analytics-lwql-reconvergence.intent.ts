import { createLogger } from "@langwatch/observability";

import {
  clickHouseErrorCodeFields,
  clickHouseErrorSummary,
  type LwqlAccessModelOwner,
} from "../rules/langwatch-ql-config-store.rules.ts";

const logger = createLogger("langwatch:analytics:lwql:reconvergence");

export const LWQL_RECONVERGENCE_PROCESS_NAME = "lwqlReconvergence";

interface LwqlReconvergenceRunDeps {
  /** Throws when ClickHouse is unreachable; the next wake probes again. */
  readonly probe: () => Promise<LwqlAccessModelOwner>;
  /** The whole self-provisioning run; logs and swallows its own failure. */
  readonly converge: () => Promise<void>;
  /** Rendered mode's app-owned objects; throws on failure so a later wake retries. */
  readonly convergeAppOwned: () => Promise<void>;
  /** Writes each project's missing key-map row; level-triggered, so a rerun inserts nothing. */
  readonly fillKeyMap: () => Promise<unknown>;
}

/** Whether the app-owned objects converged; a failure is logged and leaves them to a later wake. */
async function convergeAppOwned({
  deps,
  final,
}: {
  deps: LwqlReconvergenceRunDeps;
  final: boolean;
}): Promise<boolean> {
  try {
    await deps.convergeAppOwned();
    return true;
  } catch (error) {
    const fields = { error: clickHouseErrorSummary(error), ...clickHouseErrorCodeFields(error) };
    if (final) {
      logger.error(
        fields,
        "lwql reconvergence watch gave up converging the app-owned LangWatchQL objects after the budget expired; the next boot converges again",
      );
    } else {
      logger.warn(fields, "lwql app-owned objects did not converge; the next wake retries");
    }
    return false;
  }
}

/**
 * Converges the app-owned objects until one run succeeds in this process, then re-provisions
 * the access model only when neither the config store nor an app-owned model holds the identity.
 */
export function runLwqlReconvergence(
  deps: LwqlReconvergenceRunDeps,
): (payload: { final: boolean; fillKeyMap: boolean }) => Promise<void> {
  let appOwnedConverged = false;
  return async ({ final, fillKeyMap }): Promise<void> => {
    if (fillKeyMap) {
      await deps.fillKeyMap().catch((error: unknown) => {
        logger.warn({ error }, "lwql key-map fill at boot failed; the next boot fills again");
      });
    }
    if (!appOwnedConverged) appOwnedConverged = await convergeAppOwned({ deps, final });
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
