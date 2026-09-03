import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config";

/**
 * The event store's shared endpoint, the one leaf every process that reads or
 * writes ClickHouse binds identically.
 *
 * Per-organization private routes are NOT here: their names carry the
 * organization id (`CLICKHOUSE_URL__<label>__<organizationId>`), so there is
 * no fixed set to declare and every process parses them off the raw
 * environment with the shared `parseRoutingTable` helper instead. A caller
 * that needs the operator-only EXPLAIN identity or the restricted LangWatchQL
 * identity declares those leaves itself, beside this one.
 */
export const clickhouseConfigDefinition = RuntimeConfig.define({
  url: Config.value(z.string().optional(), { env: "CLICKHOUSE_URL" }),
});
