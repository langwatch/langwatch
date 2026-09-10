// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import { createServer as createHttpServer, request as httpRequest } from "node:http";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, createServerModuleRunner } from "vite";

/**
 * SPIKE, opt-in via LANGWATCH_DEV_HOT=1. Everything else (backend.entrypoint.ts,
 * dev-supervisor.mjs --watch) is unchanged; this file proves module-level hot
 * reload for the api half only, per dev/docs/plans/lane-brief.md's caller.
 *
 * Shape: this host owns ONE http.Server for the process's life and never
 * rebinds it. Vite's server module runner owns the api's composition entry
 * (apps/api/src/api.executable.ts + app/api-standalone.composition.ts, the
 * pair api.main.ts documents as "what returns the Hono app and the
 * lifecycle" - see README-hot.md for why a *second*, host-owned socket is
 * what actually makes the listener durable). On a file change the runner
 * invalidates the changed module and its importers, we re-import the
 * composition entry on an alternate inner port, and once the new app answers
 * we swap the front server's proxy target and close the previous
 * composition's lifecycle. Two inner ports so the swap has no gap: the new
 * composition is listening before the old one is asked to stop.
 *
 * INFRA_EXTERNAL keeps the process-owned collaborators (Prisma, Redis,
 * ClickHouse, the secrets/config resolution chain) out of Vite's module
 * graph so a source edit never invalidates them - see README-hot.md's
 * breakage list for where that boundary does and does not hold today.
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const API_EXECUTABLE = fileURLToPath(
  new URL("../../../apps/api/src/api.executable.ts", import.meta.url),
);
const API_STANDALONE_COMPOSITION = fileURLToPath(
  new URL("../../../apps/api/src/app/api-standalone.composition.ts", import.meta.url),
);

const HOST_PORT = Number(process.env.PORT ?? 5590);
const INNER_PORTS = [HOST_PORT + 1, HOST_PORT + 2] as const;
const DEBOUNCE_MS = Number(process.env.LANGWATCH_DEV_WATCH_DEBOUNCE_MS ?? 750);

/**
 * `true` externalises every node_modules import - third-party packages and,
 * because pnpm links workspace packages into node_modules too, every
 * `@langwatch/*` and `modules/*` package apps/api imports by name. Those are
 * exactly the process-lifetime collaborators (Prisma, Redis, ClickHouse,
 * OpenTelemetry, config/secrets resolution): they load once through Node's
 * own `import()` cache and are never re-executed by a source edit. Only
 * `apps/api/src/**`, resolved by relative path rather than package name,
 * stays inside Vite's graph and is what the module runner invalidates. See
 * README-hot.md for where this boundary does not hold.
 */
const INFRA_EXTERNAL = true;

type InnerAddress = { host: string; port: number };
type BootedApi = {
  runtime: { close(): Promise<void>; start(): Promise<InnerAddress | undefined> };
  address: InnerAddress;
};

const write = (line: string): void => void process.stderr.write(`[dev-hot] ${line}\n`);

async function bootComposition(port: number): Promise<BootedApi> {
  const runner = moduleRunner();
  const [{ startApiExecutable }, { ApiStandaloneComposition }] = await Promise.all([
    runner.import(API_EXECUTABLE),
    runner.import(API_STANDALONE_COMPOSITION),
  ]);
  const env = { ...process.env, API_PORT: String(port), API_HOST: "127.0.0.1" };
  const runtime = await startApiExecutable({
    source: env,
    composition: ApiStandaloneComposition.create(),
    signals: false,
  });
  const address = await runtime.start();
  if (!address) throw new Error("api composition started without a listener address");
  return { runtime, address };
}

let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
let runner: ReturnType<typeof createServerModuleRunner> | undefined;

function moduleRunner(): ReturnType<typeof createServerModuleRunner> {
  if (!runner) throw new Error("vite module runner not started yet");
  return runner;
}

let slot = 0;
let current: BootedApi | undefined;
let reloading: Promise<void> | undefined;
let pendingTimer: NodeJS.Timeout | undefined;

async function reload(reason: string): Promise<void> {
  const nextPort = INNER_PORTS[slot === 0 ? 1 : 0];
  const startedAt = performance.now();
  let next: BootedApi;
  try {
    next = await bootComposition(nextPort);
  } catch (error) {
    write(`reload failed (${reason}), keeping the running composition: ${String(error)}`);
    return;
  }
  const previous = current;
  current = next;
  slot = slot === 0 ? 1 : 0;
  write(`swapped in ${(performance.now() - startedAt).toFixed(0)}ms (${reason})`);
  if (previous) await previous.runtime.close().catch((error) => write(`previous close failed: ${String(error)}`));
}

function scheduleReload(reason: string): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    reloading = (reloading ?? Promise.resolve()).then(() => reload(reason));
  }, DEBOUNCE_MS);
}

function startFrontServer(): void {
  const front = createHttpServer((req, res) => {
    if (!current) {
      res.writeHead(503).end("api composition not ready");
      return;
    }
    const upstream = httpRequest(
      { host: current.address.host, port: current.address.port, path: req.url, method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => res.writeHead(502).end("api composition unreachable"));
    req.pipe(upstream);
  });
  front.listen(HOST_PORT, () => write(`listening on :${HOST_PORT} (module hot reload)`));

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      void (async () => {
        front.close();
        await vite?.close();
        await current?.runtime.close();
        process.exit(0);
      })();
    });
  }
}

async function main(): Promise<void> {
  vite = await createViteServer({
    configFile: false,
    root: REPO_ROOT,
    appType: "custom",
    clearScreen: false,
    logLevel: "warn",
    server: { middlewareMode: true, hmr: true, watch: { ignored: ["**/dist/**", "**/__tests__/**"] } },
    optimizeDeps: { noDiscovery: true },
    ssr: { external: INFRA_EXTERNAL },
  });
  runner = createServerModuleRunner(vite.environments.ssr, { hmr: true });
  vite.watcher.on("change", (file) => scheduleReload(`change: ${file.replace(`${REPO_ROOT}/`, "")}`));
  vite.watcher.on("add", (file) => scheduleReload(`add: ${file.replace(`${REPO_ROOT}/`, "")}`));

  startFrontServer();
  await reload("initial boot");
}

void main().catch((error) => {
  write(`fatal: ${String(error)}`);
  process.exitCode = 1;
});
