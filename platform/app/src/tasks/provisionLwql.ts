/**
 * Deploy-time entrypoint for LangWatchQL provisioning: the application owns the
 * whole access model on every distribution (issue #8258) and converges it on
 * every boot. This task is a thin wrapper — the env/inputs resolution and the
 * converge itself live in `../server/analytics/lwql/provisioning`, shared with
 * the app server's reconvergence watch — so this only resolves the inputs and
 * runs the converge once, non-fatally.
 *
 * The path is deliberately non-fatal — a default-on feature must never turn a
 * server-side provisioning failure into a boot crashloop; on a hard failure the
 * endpoint simply stays fail-closed ("unavailable") until a later boot
 * converges. A deploy with no `LWQL_CLICKHOUSE_PASSWORD` is unaffected:
 * {@link lwqlSelfProvisionInputs} returns `null` and this task exits immediately.
 *
 * Runs after `clickhouseMigrate` (migration 00084 creates the key-map table the
 * converge writes into) in `start:prepare:db`.
 *
 * @see ../server/analytics/lwql/provisioning/selfProvisionEntry.ts — the shared
 *   inputs/converge/probe this wraps
 * @see specs/lwql/api.feature
 */

import { createLogger } from "@langwatch/observability";
import {
  lwqlSelfProvisionInputs,
  selfProvisionAll,
} from "../server/analytics/lwql/provisioning";

const logger = createLogger("langwatch:task:provisionLwql");

export default async function execute() {
  // The app owns the model on every distribution, so there is one path and no
  // switch. `lwqlSelfProvisionInputs` returns the derived inputs when both
  // LangWatchQL passwords are set, or null when they are not.
  const inputs = lwqlSelfProvisionInputs();
  if (!inputs) {
    // A password present but the inputs incomplete (both are `optional: true`
    // in the chart) is a misconfiguration to surface, not a crash: declining
    // loudly keeps the boot-never-crashes contract. No password at all is
    // simply a deployment not running LangWatchQL.
    if (process.env.LWQL_CLICKHOUSE_PASSWORD) {
      logger.warn(
        "LangWatchQL is partially configured — skipping provisioning this boot; queries stay refused (fail-closed) until the configuration is complete",
      );
    } else {
      logger.info("LWQL not configured, skipping");
    }
    return;
  }

  // `sourceDatabase` is parsed inside selfProvisionAll's try, so a CLICKHOUSE_URL
  // that parses but names an invalid database identifier degrades non-fatally
  // instead of throwing out of this task.
  await selfProvisionAll(inputs);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Replaces every occurrence of each secret with a fixed marker.
 *
 * A ClickHouse error can echo the DDL that failed, and the access-model DDL
 * embeds `LWQL_CLICKHOUSE_PASSWORD`; the admin `CLICKHOUSE_URL` can likewise
 * surface in a connection error. Both are stripped before the message is
 * logged or re-thrown. Literal `split`/`join` so no secret has to be escaped
 * into a regexp. Empty/undefined secrets are skipped, never matched.
 */
export function redactSecrets(
  text: string,
  secrets: readonly (string | undefined)[],
): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

/**
 * Aborts with a redacted error when access-model reconciliation fails — the
 * fail-closed-by-throwing path.
 *
 * NOTE: the boot task above delegates the converge to
 * `../server/analytics/lwql/provisioning`, which is deliberately non-fatal (a
 * default-on feature must not crashloop a boot) and never embeds the plaintext
 * password in its DDL (it renders `passwordSha256Hex`), so `execute()` does not
 * call this. It is retained as a standalone, tested redaction helper
 * (provisionLwql.redaction.unit.test.ts) for callers that reconcile with the
 * plaintext-bearing DDL and want to abort rather than log-and-continue.
 */
export function failClosedOnAccessModelReconciliation({
  error,
  secrets,
}: {
  error: unknown;
  secrets: readonly (string | undefined)[];
}): never {
  const redacted = redactSecrets(errorMessage(error), secrets);
  logger.error(
    { error: redacted },
    "lwql self-provisioning: failed to reconcile ClickHouse access model — aborting",
  );
  throw new Error(
    `lwql self-provisioning: failed to reconcile ClickHouse access model: ${redacted}`,
  );
}
