/**
 * What "warm" actually means.
 *
 * The daemon's speed-up is not magic; it is three costs paid once instead of
 * once per invocation:
 *
 *  1. MODULE GRAPH. The CLI lazily imports each command's module on first use
 *     (~40ms for a command that pulls in the client SDK, zod and openapi-fetch).
 *     In a daemon that happens once, ever. This module pre-pays it for the
 *     commands an agent actually leans on, so even the FIRST request after a
 *     spawn is fast.
 *
 *  2. HTTP CONNECTIONS. Every command builds its API client on top of the global
 *     `fetch`, whose undici dispatcher pools and keeps sockets alive per
 *     PROCESS. In a per-invocation CLI that pool is born and dies with the
 *     command, so every call pays a fresh TCP + TLS handshake. In a daemon the
 *     pool outlives the command and the next one reuses the open connection.
 *     Nothing to configure — it comes free with the process living longer, and
 *     it is a large share of the win against a real (non-localhost) endpoint.
 *
 *  3. AUTH / CONFIG RESOLUTION. `~/.langwatch/config.json` and `.env` are read
 *     and parsed once at boot rather than on every command.
 *
 * The imports below are static and their namespaces are held in an array — a
 * bare `import "…"` for side effects would be dropped by the bundler, and the
 * whole point is to force the graph to load.
 */

import * as promptList from "../commands/list";
import * as status from "../commands/status";
import * as analyticsQuery from "../commands/analytics/query";
import * as tracesGet from "../commands/traces/get";
import * as tracesSearch from "../commands/traces/search";

/**
 * Command modules the Langy agent reads from constantly. Deliberately short:
 * every entry is memory the daemon holds forever, and a command that is not
 * here simply pays its own import once, on its first use.
 */
const WARM: unknown[] = [
  tracesSearch,
  tracesGet,
  analyticsQuery,
  promptList,
  status,
];

export function warmCommandModules(): number {
  return WARM.length;
}
