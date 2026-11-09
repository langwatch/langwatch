/**
 * Who ran a key's LangWatchQL query, for its log line and metrics only: Langy's own session key
 * first, then the client its identity headers name. Pure.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */
import type {
  LangWatchQLKeyDoor,
  LangWatchQLKeyReach,
  LangWatchQLRunTelemetry,
} from "@langwatch/analytics-contract";
import type { CensusClient } from "@langwatch/observability/credential-census";

/** The CLI and both MCP servers apart; every other client, an SDK or a script, is `rest_api`. */
export function keyDoorOfClient({ client }: { client: CensusClient }): LangWatchQLKeyDoor {
  if (client === "cli") return "cli";
  if (client === "mcp" || client === "hosted-mcp") return "mcp";
  return "rest_api";
}

/** A Langy session key is Langy, whichever client it rode in on; any other key is its door. */
export function keyRunTelemetry({
  reach,
  door,
}: {
  reach: LangWatchQLKeyReach;
  door: LangWatchQLKeyDoor;
}): LangWatchQLRunTelemetry {
  if (reach.kind === "apiKey" && reach.isLangySessionKey === true) return { caller: "langy" };
  return { caller: door };
}
