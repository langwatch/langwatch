import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { LwqlAppOwnedDrift } from "../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import type { LwqlUnconfirmedSinceRepository } from "../repositories/langwatch-ql-unconfirmed-since.repository.ts";
import { isCollectionUnconfirmed } from "../rules/langwatch-ql-collection-probe.rules.ts";
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

/** How long after the fleet's first failed check an unconfirmed collection alerts. */
export const LWQL_UNCONFIRMED_ALERT_AFTER_MS = 15 * 60_000;

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
  /** The fleet's shared time of the first check that left tables on old credentials. */
  readonly unconfirmedSince: LwqlUnconfirmedSinceRepository;
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
  unconfirmedSince,
  now,
}: {
  store: LwqlStore;
  drift: LwqlAppOwnedDrift;
  convergeAppOwned: LwqlReconvergenceRunDeps["convergeAppOwned"];
  alerts: LwqlAlerts;
  unconfirmedSince: LwqlUnconfirmedSinceRepository;
  now: () => number;
}): Promise<boolean> {
  const only = driftIn(store, drift);
  const pending = only[store];
  // An unread PostgreSQL is neither converged nor cleared.
  if (pending === "unknown") return false;
  if (pending.length === 0) {
    alerts.delete(store);
    if (store === "clickHouse") await endUnconfirmedRun(unconfirmedSince);
    return true;
  }
  logger.info(driftFields(only), "lwql reconvergence check found app-owned objects to converge");
  try {
    await convergeAppOwned(only);
    alerts.delete(store);
    if (store === "clickHouse") await endUnconfirmedRun(unconfirmedSince);
    return true;
  } catch (error) {
    const at = now();
    const run = await readUnconfirmedRun({ error, unconfirmedSince, at });
    if (run.open && at - run.since < LWQL_UNCONFIRMED_ALERT_AFTER_MS) {
      logger.warn(
        { ...failureCodeFields(store, error), ...driftFields(only), unconfirmedSince: run.since },
        "lwql left engine tables on their current credentials while ClickHouse has not shown it holds the new ones; the check retries in 5 minutes",
      );
      return false;
    }
    logConvergeFailure({ store, error, drift: only, alerts, at });
    return false;
  }
}

/** How long the check waits on the shared clock before it treats Redis as down. */
export const LWQL_UNCONFIRMED_CLOCK_TIMEOUT_MS = 2_000;

/**
 * The Redis client queues commands while offline and retries without end, so a down Redis would
 * stall the check; past the timeout the call fails like any other Redis error.
 */
async function withinClockTimeout<T>(call: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer within ${LWQL_UNCONFIRMED_CLOCK_TIMEOUT_MS} ms`)),
      LWQL_UNCONFIRMED_CLOCK_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** A shared run of unconfirmed checks, open since its first failure; closed alerts at once. */
type LwqlUnconfirmedRun =
  | { readonly open: false }
  | { readonly open: true; readonly since: number };

/**
 * Extends the shared run when this failure is an unconfirmed collection; otherwise ends it.
 * An unreadable run reads as closed, so the check alerts rather than stays silent.
 */
async function readUnconfirmedRun({
  error,
  unconfirmedSince,
  at,
}: {
  error: unknown;
  unconfirmedSince: LwqlUnconfirmedSinceRepository;
  at: number;
}): Promise<LwqlUnconfirmedRun> {
  if (!isCollectionUnconfirmed(error)) {
    await endUnconfirmedRun(unconfirmedSince);
    return { open: false };
  }
  try {
    return { open: true, since: await withinClockTimeout(unconfirmedSince.mark(at)) };
  } catch (markError) {
    logger.warn(
      { error: clickHouseErrorSummary(markError) },
      "lwql could not read when ClickHouse first failed to show the new collection; alerting now",
    );
    return { open: false };
  }
}

/** A failed clear leaves the run to expire; the alert then fires early, never late. */
async function endUnconfirmedRun(unconfirmedSince: LwqlUnconfirmedSinceRepository) {
  await withinClockTimeout(unconfirmedSince.clear()).catch((error: unknown) => {
    logger.warn(
      { error: clickHouseErrorSummary(error) },
      "lwql could not clear the unconfirmed-collection clock",
    );
  });
}

/** Fills the key map, or throws the failure with its ClickHouse error kept as the cause. */
async function fillKeyMapOrThrow(
  fillKeyMap: LwqlReconvergenceRunDeps["fillKeyMap"],
): Promise<void> {
  try {
    await fillKeyMap();
  } catch (error) {
    logger.warn(
      { error: clickHouseErrorSummary(error) },
      "lwql key-map fill failed; the outbox delivers the check again, backing off to 2 hours",
    );
    throw new Error("lwql key-map fill failed; the outbox delivers the check again", {
      cause: error,
    });
  }
}

/** The SQL-mode owner probe: re-provisions once neither store owns the access model. */
async function probeAccessModel({
  probe,
  converge,
}: Pick<LwqlReconvergenceRunDeps, "probe" | "converge">): Promise<void> {
  const owner = await probe().catch((): LwqlAccessModelOwner => "config_store");
  // Awaited, never fired and forgotten: the worker's drain waits on this intent.
  if (owner === "none") await converge();
}

/** A check called outside the outbox is its first delivery. */
const FIRST_DELIVERY = { attempt: 1 };

/**
 * One check: read which app-owned objects are absent, converge PostgreSQL then ClickHouse where
 * either does, fill the key map when asked or once a converge repaired it, then the SQL-mode
 * owner probe. Any worker may run any check; the closure only rates the failure log's level.
 */
export function runLwqlReconvergence(
  deps: LwqlReconvergenceRunDeps,
): (payload: { fillKeyMap: boolean }, delivery?: { attempt: number }) => Promise<void> {
  const now = deps.now ?? (() => nowInstant().epochMilliseconds);
  const alerts: LwqlAlerts = new Map();
  const converge = (store: LwqlStore, drift: LwqlAppOwnedDrift) =>
    convergeStore({
      store,
      drift,
      convergeAppOwned: deps.convergeAppOwned,
      alerts,
      unconfirmedSince: deps.unconfirmedSince,
      now,
    });

  return async ({ fillKeyMap }, { attempt } = FIRST_DELIVERY): Promise<void> => {
    // Only a failed fill throws, so a redelivery owes that fill alone. The next wake's check
    // reads drift, converges and probes; doing it here too would converge on two workers at once.
    if (attempt > 1) return fillKeyMapOrThrow(deps.fillKeyMap);
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
    try {
      if ((fillKeyMap || keyMapRepaired) && (!keyMapRepaired || clickHouseConverged)) {
        await fillKeyMapOrThrow(deps.fillKeyMap);
      }
    } finally {
      // A failed fill still probes, then fails the check so the outbox delivers it again.
      await probeAccessModel(deps);
    }
  };
}
