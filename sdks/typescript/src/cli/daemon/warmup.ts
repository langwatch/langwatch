/**
 * Warming pre-pays module graph, HTTP pooling, and config resolution.
 * Forces imports to load before the bundler can drop them.
 */

import * as analyticsQuery from "../commands/analytics/query";
import * as promptList from "../commands/list";
import * as status from "../commands/status";
import * as tracesGet from "../commands/traces/get";
import * as tracesSearch from "../commands/traces/search";

/**
 * Command modules the Langy agent reads from constantly. Deliberately short:
 * every entry is memory the daemon holds forever, and a command that is not
 * here simply pays its own import once, on its first use.
 */
const WARM: unknown[] = [tracesSearch, tracesGet, analyticsQuery, promptList, status];

export function warmCommandModules(): number {
  return WARM.length;
}
