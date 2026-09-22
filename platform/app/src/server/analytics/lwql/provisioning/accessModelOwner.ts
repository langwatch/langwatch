/**
 * The stateless ownership probe that gates the server-side reconvergence watch.
 *
 * The watch re-provisions the app-owned LangWatchQL access model only when this
 * probe reports the model is owned by neither store, so the classification is
 * the sole gate on a destructive re-provision. It is split the same way as
 * {@link probeAppFunctionStore}/{@link canProvisionAppFunctions}: a thin
 * {@link probeLwqlAccessModelOwner} that does the I/O against an injected client,
 * and a pure {@link classifyLwqlAccessModelOwner} that makes the decision from
 * two counts — so the gate is unit-testable without a real ClickHouse.
 *
 * @see ./clickhouseStatementRunner.ts — inventoryConfigStoreLwqlEntities
 * @see ./selfProvisioning.ts — the probe/classify shape this mirrors
 * @see ./selfProvisionEntry.ts — lwqlAccessModelOwner, the wrapper
 */

import type { ClickHouseClient } from "@clickhouse/client";

import type { LangWatchQLNames } from "./accessModel";
import { inventoryConfigStoreLwqlEntities } from "./clickhouseStatementRunner";

/** Which store currently owns the LangWatchQL access model, if any. */
export type LwqlAccessModelOwner = "config_store" | "sql_store" | "none";

/**
 * The ownership decision from the two facts the probe reads: the config store
 * wins when it still renders any entity (the old pod, mid-upgrade), else the
 * app-owned SQL-store user if present, else neither.
 */
export function classifyLwqlAccessModelOwner({
  configStoreEntityCount,
  sqlStoreUserCount,
}: {
  configStoreEntityCount: number;
  sqlStoreUserCount: number;
}): LwqlAccessModelOwner {
  if (configStoreEntityCount > 0) return "config_store";
  if (sqlStoreUserCount > 0) return "sql_store";
  return "none";
}

/**
 * Reads who owns the access model right now against an injected admin client,
 * proven fresh at call time. {@link inventoryConfigStoreLwqlEntities} swallows
 * read errors and returns `[]`, so this first proves connectivity with a trivial
 * query — an unreachable ClickHouse (say, its pod mid-roll) *throws* rather than
 * reporting a spurious "none" the watch would re-provision against.
 */
export async function probeLwqlAccessModelOwner({
  client,
  names,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
}): Promise<LwqlAccessModelOwner> {
  // Connectivity check: throws on an unreachable server, so the caller can
  // distinguish "cannot read yet" from an authoritative ownership answer.
  await (
    await client.query({ query: "SELECT 1", format: "JSONEachRow" })
  ).text();

  const configStoreEntities = await inventoryConfigStoreLwqlEntities({
    client,
    names,
  });

  // Is the app-owned user present in any SQL access store? Excluding `users_xml`
  // (the config store, counted above and the same literal
  // `inventoryConfigStoreLwqlEntities` filters on) rather than pinning
  // `local_directory` keeps this correct on ClickHouse deployments whose SQL
  // storage is `replicated`, `memory`, etc.
  const result = await client.query({
    query:
      "SELECT count() AS n FROM system.users " +
      "WHERE name = {user:String} AND storage != 'users_xml'",
    query_params: { user: names.restrictedUser },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ n: number | string }>;

  return classifyLwqlAccessModelOwner({
    configStoreEntityCount: configStoreEntities.length,
    sqlStoreUserCount: Number(rows[0]?.n ?? 0),
  });
}
