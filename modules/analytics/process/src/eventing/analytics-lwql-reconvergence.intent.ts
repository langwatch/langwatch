import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { LwqlAppOwnedDrift } from "../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import {
  clickHouseErrorCodeFields,
  clickHouseErrorSummary,
  type LwqlAccessModelOwner,
  postgresErrorCodeFields,
} from "../rules/langwatch-ql-config-store.rules.ts";

const logger = createLogger("langwatch:analytics:lwql:reconvergence");

export const LWQL_RECONVERGENCE_PROCESS_NAME = "lwqlReconvergence";

type LwqlStore = "clickHouse" | "postgres";

/** The deploy path's alerting messages, one per store, so one alert covers both paths. */
const CONVERGE_FAILED_MESSAGES: Record<LwqlStore, string> = {
  clickHouse: "lwql provisioning failed creating ClickHouse objects",
  postgres: "lwql provisioning failed creating PostgreSQL objects",
};

/** An unchanged failure is logged at error again after this, so a lapsed alert fires anew. */
const REALERT_AFTER_MS = 60 * 60_000;

interface LwqlReconvergenceRunDeps {
  /** Throws when ClickHouse is unreachable; the next check probes again. */
  readonly probe: () => Promise<LwqlAccessModelOwner>;
  /** The SQL-mode re-provision of the whole access model; logs and swallows its own failure. */
  readonly converge: () => Promise<void>;
  /** Catalog reads only; throws when ClickHouse is unreadable, `unknown` when PostgreSQL is. */
  readonly findDrift: () => Promise<LwqlAppOwnedDrift>;
  /** Converges the objects the drift names; throws on failure so the next check retries. */
  readonly convergeAppOwned: (drift: LwqlAppOwnedDrift) => Promise<void>;
  /** Writes each project's missing key-map row; level-triggered, so a rerun inserts nothing. */
  readonly fillKeyMap: () => Promise<unknown>;
  /** Epoch ms; the wall clock unless a test pins it. */
  readonly now?: () => number;
}

/** The store's own codes, and the `error_signature` built from them and the error type. */
function failureCodeFields(store: LwqlStore, error: unknown) {
  const type = clickHouseErrorSummary(error).type;
  if (store === "postgres") {
    const { code, sqlState } = postgresErrorCodeFields(error);
    return { error_signature: `${code}:${sqlState}:${type}`, code, sqlState };
  }
  const { clickhouseCode, clickhouseCodeName } = clickHouseErrorCodeFields(error);
  return {
    error_signature: `${clickhouseCode}:${clickhouseCodeName}:${type}`,
    clickhouseCode,
    clickhouseCodeName,
  };
}

function driftFields(drift: LwqlAppOwnedDrift) {
  const postgres = drift.postgres === "unknown" ? [] : drift.postgres.map((gap) => gap.view);
  return {
    clickHouseObjects: drift.clickHouse.length,
    postgresViews: postgres.length,
    sample: [...drift.clickHouse, ...postgres].slice(0, 5),
  };
}

/** One store's share of the drift, so each store's failure is converged and alerted alone. */
function driftIn(store: LwqlStore, drift: LwqlAppOwnedDrift): LwqlAppOwnedDrift {
  return store === "clickHouse"
    ? { clickHouse: drift.clickHouse, postgres: [], isKeyMapMissing: drift.isKeyMapMissing }
    : { clickHouse: [], postgres: drift.postgres, isKeyMapMissing: false };
}

/** Each store's last error-level failure, which rates the next failure's log level. */
type LwqlAlerts = Map<LwqlStore, { signature: string; at: number }>;

/** Error on the first failure, on each change and hourly; warn while it repeats. */
function logConvergeFailure({
  store,
  error,
  drift,
  alerts,
  at,
}: {
  store: LwqlStore;
  error: unknown;
  drift: LwqlAppOwnedDrift;
  alerts: LwqlAlerts;
  at: number;
}): void {
  const fields = {
    error: clickHouseErrorSummary(error),
    ...failureCodeFields(store, error),
    ...driftFields(drift),
  };
  const signature = fields.error_signature;
  const last = alerts.get(store);
  if (last?.signature === signature && at - last.at < REALERT_AFTER_MS) {
    logger.warn(
      fields,
      "lwql app-owned objects still do not converge; the check retries in 5 minutes",
    );
    return;
  }
  logger.error(fields, CONVERGE_FAILED_MESSAGES[store]);
  alerts.set(store, { signature, at });
}

/** Converges one store's share of the drift; true when that store is now converged. */
async function convergeStore({
  store,
  drift,
  convergeAppOwned,
  alerts,
  now,
}: {
  store: LwqlStore;
  drift: LwqlAppOwnedDrift;
  convergeAppOwned: LwqlReconvergenceRunDeps["convergeAppOwned"];
  alerts: LwqlAlerts;
  now: () => number;
}): Promise<boolean> {
  const only = driftIn(store, drift);
  const pending = only[store];
  // An unread PostgreSQL is neither converged nor cleared.
  if (pending === "unknown") return false;
  if (pending.length === 0) {
    alerts.delete(store);
    return true;
  }
  logger.info(driftFields(only), "lwql reconvergence check found app-owned objects to converge");
  try {
    await convergeAppOwned(only);
    alerts.delete(store);
    return true;
  } catch (error) {
    logConvergeFailure({ store, error, drift: only, alerts, at: now() });
    return false;
  }
}

/**
 * One check: read which app-owned objects are absent, converge PostgreSQL then ClickHouse where
 * either does, fill the key map when asked or once a converge repaired it, then the SQL-mode
 * owner probe. Any worker may run any check; the closure only rates the failure log's level.
 */
export function runLwqlReconvergence(
  deps: LwqlReconvergenceRunDeps,
): (payload: { fillKeyMap: boolean }) => Promise<void> {
  const now = deps.now ?? (() => nowInstant().epochMilliseconds);
  const alerts: LwqlAlerts = new Map();
  const converge = (store: LwqlStore, drift: LwqlAppOwnedDrift) =>
    convergeStore({ store, drift, convergeAppOwned: deps.convergeAppOwned, alerts, now });

  return async ({ fillKeyMap }): Promise<void> => {
    const drift = await deps.findDrift().catch((error: unknown): undefined => {
      logger.warn(
        { error: clickHouseErrorSummary(error) },
        "lwql reconvergence check could not read the ClickHouse catalog; it checks again in 5 minutes",
      );
      return undefined;
    });
    // Unread is not converged: an unreadable catalog leaves the last alert as it was.
    if (drift !== undefined) await converge("postgres", drift);
    const clickHouseConverged = drift === undefined || (await converge("clickHouse", drift));
    const keyMapRepaired = drift?.isKeyMapMissing === true;
    if ((fillKeyMap || keyMapRepaired) && (!keyMapRepaired || clickHouseConverged)) {
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
