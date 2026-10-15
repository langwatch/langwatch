import { createLogger } from "@langwatch/observability";

import type { LwqlAppOwnedDrift } from "../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import {
  clickHouseErrorCodeFields,
  clickHouseErrorSummary,
  type LwqlAccessModelOwner,
} from "../rules/langwatch-ql-config-store.rules.ts";

const logger = createLogger("langwatch:analytics:lwql:reconvergence");

export const LWQL_RECONVERGENCE_PROCESS_NAME = "lwqlReconvergence";

/** The deploy runner's alerting signature, so one alert covers both paths. */
const CONVERGE_FAILED_SIGNATURE = "lwql provisioning failed creating ClickHouse objects";

const UNKNOWN_DRIFT: LwqlAppOwnedDrift = { clickHouse: [], postgres: [], keyMap: false };

interface LwqlReconvergenceRunDeps {
  /** Throws when ClickHouse is unreachable; the next check probes again. */
  readonly probe: () => Promise<LwqlAccessModelOwner>;
  /** The SQL-mode re-provision of the whole access model; logs and swallows its own failure. */
  readonly converge: () => Promise<void>;
  /** Catalog reads only, never DDL; empty outside rendered mode, throws when unreadable. */
  readonly findDrift: () => Promise<LwqlAppOwnedDrift>;
  /** Converges the halves the drift names; throws on failure so the next check retries. */
  readonly convergeAppOwned: (drift: LwqlAppOwnedDrift) => Promise<void>;
  /** Writes each project's missing key-map row; level-triggered, so a rerun inserts nothing. */
  readonly fillKeyMap: () => Promise<unknown>;
}

function failureSignature(error: unknown): string {
  const { clickhouseCode, clickhouseCodeName } = clickHouseErrorCodeFields(error);
  return `${clickhouseCode}:${clickhouseCodeName}:${clickHouseErrorSummary(error).type}`;
}

function driftFields(drift: LwqlAppOwnedDrift) {
  return {
    clickHouseObjects: drift.clickHouse.length,
    postgresViews: drift.postgres.length,
    sample: [...drift.clickHouse, ...drift.postgres].slice(0, 5),
  };
}

/**
 * One check: read what the app-owned objects lack, converge only when something does, fill the
 * key map when asked or once a converge repaired it, then the SQL-mode owner probe. Any worker
 * may run any check; the one closure variable only rates the failure log's level.
 */
export function runLwqlReconvergence(
  deps: LwqlReconvergenceRunDeps,
): (payload: { fillKeyMap: boolean }) => Promise<void> {
  let lastFailure: string | null = null;

  async function convergeAppOwned(drift: LwqlAppOwnedDrift): Promise<boolean> {
    logger.info(driftFields(drift), "lwql reconvergence check found app-owned objects to converge");
    try {
      await deps.convergeAppOwned(drift);
      lastFailure = null;
      return true;
    } catch (error) {
      const signature = failureSignature(error);
      const fields = {
        error: clickHouseErrorSummary(error),
        ...clickHouseErrorCodeFields(error),
        ...driftFields(drift),
      };
      // Error on the first failure and on each change, warn while it repeats: one alert per change.
      if (signature === lastFailure) {
        logger.warn(
          fields,
          "lwql app-owned objects still do not converge; the check retries in 5 minutes",
        );
      } else {
        logger.error(fields, CONVERGE_FAILED_SIGNATURE);
      }
      lastFailure = signature;
      return false;
    }
  }

  return async ({ fillKeyMap }): Promise<void> => {
    const drift = await deps.findDrift().catch((error: unknown): LwqlAppOwnedDrift => {
      logger.warn(
        { error: clickHouseErrorSummary(error) },
        "lwql reconvergence check could not read the ClickHouse catalog; it checks again in 5 minutes",
      );
      return UNKNOWN_DRIFT;
    });
    const pending = drift.clickHouse.length + drift.postgres.length > 0;
    const converged = pending ? await convergeAppOwned(drift) : true;
    if ((fillKeyMap || drift.keyMap) && (!drift.keyMap || converged)) {
      await deps.fillKeyMap().catch((error: unknown) => {
        logger.warn(
          { error: clickHouseErrorSummary(error) },
          "lwql key-map fill failed; the next check that asks for one fills again",
        );
      });
    }
    const owner = await deps.probe().catch((): LwqlAccessModelOwner => "config_store");
    if (owner !== "none") return;
    // Awaited, never fired and forgotten: the worker's drain waits on this intent.
    await deps.converge();
  };
}
