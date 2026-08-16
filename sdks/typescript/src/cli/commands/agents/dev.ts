import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import chalk from "chalk";
import prompts from "prompts";
import {
  AgentsApiService,
  type AgentResponse,
} from "@/client-sdk/services/agents/agents-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { loadConfig, saveConfig } from "../../utils/governance/config";

/**
 * The per-session auth header the local proxy requires on every tunneled
 * request. Written onto the agent config for the session and removed on exit,
 * so a public quick-tunnel URL is never an open relay to the local agent.
 */
export const DEV_SECRET_HEADER = "X-LangWatch-Dev-Secret";

/** How long to wait for the tunnel to report its public URL. */
const TUNNEL_URL_TIMEOUT_MS = 30_000;

const CLOUDFLARE_TERMS_URL = "https://www.cloudflare.com/website-terms/";

interface HeaderRow {
  key: string;
  value: string;
}

/** Reads `config.headers` defensively; the config is untyped JSON here. */
function readHeaderRows(config: Record<string, unknown>): HeaderRow[] {
  if (!Array.isArray(config.headers)) return [];
  return config.headers.filter(
    (row): row is HeaderRow =>
      !!row &&
      typeof row === "object" &&
      typeof (row as HeaderRow).key === "string" &&
      typeof (row as HeaderRow).value === "string",
  );
}

/** Header rows with any dev-secret row removed (case-insensitive on the key). */
function withoutDevSecretHeader(rows: HeaderRow[]): HeaderRow[] {
  return rows.filter(
    (row) => row.key.toLowerCase() !== DEV_SECRET_HEADER.toLowerCase(),
  );
}

/**
 * The written URL keeps the previous URL's request path on the tunnel host:
 * the platform posts to the agent URL verbatim, so a bare tunnel URL would
 * land every request on `/` instead of the path the local server serves.
 */
function tunnelUrlWithPreviousPath({
  tunnelUrl,
  previousUrl,
}: {
  tunnelUrl: string;
  previousUrl?: string;
}): string {
  if (!previousUrl) return tunnelUrl;
  try {
    const previous = new URL(previousUrl);
    const path = `${previous.pathname}${previous.search}`;
    if (path === "/" || path === "") return tunnelUrl;
    return `${tunnelUrl.replace(/\/+$/, "")}${path}`;
  } catch {
    return tunnelUrl;
  }
}

/**
 * The write-back: config with `url` REPLACED by the tunnel URL carrying the
 * previous URL's path, and the previous URL stashed under `devTunnel` so exit
 * can restore it. Replace, never append. When a crashed session left a
 * `devTunnel` behind, the original `previousUrl` is kept: the current `url`
 * is a dead tunnel, and restoring to it would restore nothing.
 *
 * With `secret` set, the dev-secret header row is written too, replacing any
 * existing row with that key, never appending a duplicate. Without a secret
 * (`--no-auth`), any stale dev-secret row is removed.
 */
export function applyDevTunnel({
  config,
  tunnelUrl,
  secret,
  connectedAt = new Date().toISOString(),
}: {
  config: Record<string, unknown>;
  tunnelUrl: string;
  secret?: string;
  connectedAt?: string;
}): Record<string, unknown> {
  const existingStash = config.devTunnel as
    | { previousUrl?: string }
    | undefined;
  const previousUrl =
    existingStash?.previousUrl ??
    (typeof config.url === "string" ? config.url : undefined);

  const headers = withoutDevSecretHeader(readHeaderRows(config));
  if (secret) headers.push({ key: DEV_SECRET_HEADER, value: secret });

  return {
    ...config,
    url: tunnelUrlWithPreviousPath({ tunnelUrl, previousUrl }),
    headers,
    devTunnel: {
      ...(previousUrl !== undefined ? { previousUrl } : {}),
      connectedAt,
    },
  };
}

/**
 * The restore: config with the previous URL back in place, the `devTunnel`
 * stash dropped, and the dev-secret header row removed. Returns null when the
 * config carries no `devTunnel`, meaning nothing to restore, so the caller can skip
 * the PATCH entirely (idempotence: a second restore is a no-op).
 */
export function restoreDevTunnel({
  config,
}: {
  config: Record<string, unknown>;
}): Record<string, unknown> | null {
  const stash = config.devTunnel as { previousUrl?: string } | undefined;
  if (!stash || typeof config.devTunnel !== "object") return null;

  const restored: Record<string, unknown> = {
    ...config,
    headers: withoutDevSecretHeader(readHeaderRows(config)),
  };
  delete restored.devTunnel;
  if (typeof stash.previousUrl === "string" && stash.previousUrl.length > 0) {
    restored.url = stash.previousUrl;
  }
  return restored;
}

/**
 * The project simulations page, derived from the agent's `platformUrl`
 * (`https://…/<project-slug>/agents?…`): same origin, same project slug,
 * `/simulations` path.
 */
export function deriveSimulationsUrl(
  platformUrl: string | undefined,
): string | undefined {
  if (!platformUrl) return undefined;
  try {
    const parsed = new URL(platformUrl);
    const slug = parsed.pathname.split("/").find(Boolean);
    if (!slug) return undefined;
    return `${parsed.origin}/${slug}/simulations`;
  } catch {
    return undefined;
  }
}

export interface AuthProxy {
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * The path a forwarded request uses on the local server. The platform posts
 * the agent's real path (the write-back keeps it on the tunnel URL), so a
 * non-root incoming path is forwarded verbatim; a bare request falls back to
 * the target URL's own path (`--url` with a path).
 */
function joinProxyPath(targetPath: string, incoming: string): string {
  if (incoming === "/" || incoming === "") {
    const base = targetPath.replace(/\/+$/, "");
    return base === "" ? "/" : base;
  }
  return incoming.startsWith("/") ? incoming : `/${incoming}`;
}

/**
 * The local auth proxy: an ephemeral-port HTTP server that forwards every
 * request to the target local URL and rejects requests that do not carry the
 * session secret in the dev-secret header with 401. The tunnel points at this
 * proxy, so only the platform (which got the secret via the agent config)
 * can reach the local agent through the public URL.
 */
export function startAuthProxy({
  targetUrl,
  secret,
}: {
  targetUrl: string;
  secret: string;
}): Promise<AuthProxy> {
  const target = new URL(targetUrl);
  const requestFn = target.protocol === "https:" ? https.request : http.request;

  const server = http.createServer((req, res) => {
    const presented = req.headers[DEV_SECRET_HEADER.toLowerCase()];
    if (presented !== secret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "Missing or invalid dev tunnel secret. Requests must come through the LangWatch platform.",
        }),
      );
      return;
    }

    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers[DEV_SECRET_HEADER.toLowerCase()];

    const upstream = requestFn(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: joinProxyPath(target.pathname, req.url ?? "/"),
        method: req.method,
        headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
      }
      res.end(
        JSON.stringify({
          error: `Could not reach the local agent at ${targetUrl}: ${error.message}`,
        }),
      );
    });
    req.pipe(upstream);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("The auth proxy could not bind a local port"));
        return;
      }
      resolve({
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

export interface AgentDevOptions {
  port?: string;
  url?: string;
  agent?: string;
  tunnelUrl?: string;
  /** commander `--no-update-url`: false when the flag is passed. */
  updateUrl?: boolean;
  /** commander `--no-auth`: false when the flag is passed. */
  auth?: boolean;
  apiKey?: string;
}

/** The tunnel process surface the session needs, satisfied by cloudflared's Tunnel. */
interface TunnelHandle {
  stop: () => void;
  once(event: "url", listener: (url: string) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(
    event: "exit",
    listener: (code: number | null, signal: unknown) => void,
  ): unknown;
}

export interface AgentDevSession {
  /** Resolves with the exit code once shutdown finishes. */
  done: Promise<number>;
  shutdown: (code?: number) => Promise<void>;
}

function fail(message: string): never {
  reportCommandError({ error: commandValidationError(message) });
  process.exit(1);
}

/** The local URL the flags point at, after mutual-exclusion validation. */
function resolveLocalUrl(options: AgentDevOptions): string {
  if (options.port && options.url) {
    fail("--port and --url are mutually exclusive. Pass one of them.");
  }
  if (options.port) {
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      fail(`--port must be a number between 1 and 65535, got "${options.port}"`);
    }
    return `http://localhost:${port}`;
  }
  if (options.url) {
    let parsed: URL;
    try {
      parsed = new URL(options.url);
    } catch {
      fail(`--url must be a valid URL, got "${options.url}"`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      fail("--url must be an http or https URL");
    }
    return options.url;
  }
  fail(
    "Pass the local server to expose: --port <number> for http://localhost:<number>, or --url <local url>.",
  );
}

/** Remember the chosen agent for this directory in ~/.langwatch/config.json. */
function rememberAgentForDirectory(agentId: string): void {
  try {
    const cfg = loadConfig();
    cfg.agent_dev_agents = {
      ...(cfg.agent_dev_agents ?? {}),
      [process.cwd()]: agentId,
    };
    saveConfig(cfg);
  } catch {
    // Best-effort convenience; a config write failure must not block the run.
  }
}

function rememberedAgentForDirectory(): string | undefined {
  try {
    return loadConfig().agent_dev_agents?.[process.cwd()];
  } catch {
    return undefined;
  }
}

/**
 * Resolve which registered HTTP agent this session repoints:
 *
 *   1. `--agent <id|name>`: an exact id, else a name match over HTTP agents.
 *   2. The agent remembered for this directory from a previous run.
 *   3. An interactive picker over the project's HTTP agents (TTY only).
 */
async function resolveTargetAgent({
  service,
  agentFlag,
}: {
  service: AgentsApiService;
  agentFlag?: string;
}): Promise<AgentResponse> {
  const listing = await service.list({ limit: 100 });
  const httpAgents = listing.data.filter((agent) => agent.type === "http");

  if (agentFlag) {
    const byId = listing.data.find((agent) => agent.id === agentFlag);
    const byName = httpAgents.filter(
      (agent) => agent.name.toLowerCase() === agentFlag.toLowerCase(),
    );
    const match = byId ?? byName[0];
    if (!match) {
      fail(
        `No agent matches "${agentFlag}". Run \`langwatch agent list\` to see the registered agents.`,
      );
    }
    if (match.type !== "http") {
      fail(
        `Agent "${match.name}" has type "${match.type}". Only HTTP agents can point at a local tunnel.`,
      );
    }
    if (!byId && byName.length > 1) {
      fail(
        `More than one HTTP agent is named "${agentFlag}". Pass the agent id instead: langwatch agent dev --agent <id>`,
      );
    }
    return match;
  }

  const remembered = rememberedAgentForDirectory();
  if (remembered) {
    const match = httpAgents.find((agent) => agent.id === remembered);
    if (match) {
      console.log(
        chalk.gray(
          `Using agent "${match.name}" remembered for this directory (override with --agent).`,
        ),
      );
      return match;
    }
  }

  if (httpAgents.length === 0) {
    fail(
      "This project has no HTTP agents. Create one first: langwatch agent create \"My Agent\" --type http --config '{\"url\":\"https://...\"}'",
    );
  }
  if (httpAgents.length === 1) {
    return httpAgents[0]!;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(
      "More than one HTTP agent is registered. Pass which one to use: langwatch agent dev --agent <id|name>",
    );
  }

  const answer = await prompts({
    type: "select",
    name: "agentId",
    message: "Which agent should point at your machine?",
    choices: httpAgents.map((agent) => ({
      title: agent.name,
      description: typeof agent.config?.url === "string" ? agent.config.url : undefined,
      value: agent.id,
    })),
    initial: 0,
  });
  const chosen = httpAgents.find((agent) => agent.id === answer.agentId);
  if (!chosen) {
    fail("No agent selected.");
  }
  return chosen;
}

/**
 * Provision the Cloudflare quick tunnel via the `cloudflared` package,
 * downloading the binary on first use (with the Cloudflare terms notice
 * printed before the download). Resolves with the public URL and a handle to
 * stop the tunnel; rejects when no URL arrives within the timeout.
 *
 * The import is lazy on purpose: only tunnel-provisioning runs pay for it,
 * and `--tunnel-url` sessions never load it (CLI boot-graph rule).
 */
async function startQuickTunnel({
  localUrl,
}: {
  localUrl: string;
}): Promise<{ url: string; tunnel: TunnelHandle }> {
  const cloudflared = await import("cloudflared");

  if (!fs.existsSync(cloudflared.bin)) {
    console.log(
      chalk.gray(
        `First run: downloading the cloudflared binary. Quick tunnels are a Cloudflare service, subject to the Cloudflare terms: ${CLOUDFLARE_TERMS_URL}`,
      ),
    );
    await cloudflared.install(cloudflared.bin);
  }

  const tunnel = cloudflared.Tunnel.quick(localUrl);
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      tunnel.stop();
      reject(
        new Error(
          `The tunnel did not report a public URL within ${TUNNEL_URL_TIMEOUT_MS / 1000} seconds. Check your network connection and try again, or bring your own tunnel with --tunnel-url.`,
        ),
      );
    }, TUNNEL_URL_TIMEOUT_MS);
    tunnel.once("url", (tunnelUrl: string) => {
      clearTimeout(timeout);
      resolve(tunnelUrl);
    });
    tunnel.once("error", (error: Error) => {
      clearTimeout(timeout);
      tunnel.stop();
      reject(error);
    });
    tunnel.once("exit", (code: number | null) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `The tunnel process exited (code ${code ?? "unknown"}) before reporting a URL. Try again, or bring your own tunnel with --tunnel-url.`,
        ),
      );
    });
  });

  return { url, tunnel };
}

function printBanner({
  tunnelUrl,
  localUrl,
  agent,
  previousUrl,
  updatedUrl,
}: {
  tunnelUrl: string;
  localUrl: string;
  agent: AgentResponse;
  previousUrl?: string;
  updatedUrl: boolean;
}): void {
  console.log();
  console.log(
    `${chalk.green("Tunnel up:")} ${chalk.cyan(tunnelUrl)} ${chalk.gray("->")} ${chalk.cyan(localUrl)}`,
  );
  if (updatedUrl) {
    console.log(
      `Agent ${chalk.bold(`"${agent.name}"`)} now points at your machine${
        previousUrl ? chalk.gray(` (was ${previousUrl})`) : ""
      }.`,
    );
    const simulationsUrl = deriveSimulationsUrl(agent.platformUrl);
    if (simulationsUrl) {
      console.log(`Run your scenarios: ${chalk.cyan(simulationsUrl)}`);
    }
    console.log(chalk.gray("Ctrl-C restores the previous URL."));
  } else {
    console.log(
      chalk.gray(
        `--no-update-url: agent "${agent.name}" was not changed. Point callers at the tunnel URL yourself.`,
      ),
    );
  }
  console.log();
}

/**
 * Start a dev tunnel session. Exported separately from the command so tests
 * can drive the full lifecycle (write-back, restore, shutdown) without
 * process signals or `process.exit`.
 */
export async function startAgentDevSession(
  options: AgentDevOptions,
): Promise<AgentDevSession> {
  const localUrl = resolveLocalUrl(options);
  if (options.tunnelUrl) {
    try {
      new URL(options.tunnelUrl);
    } catch {
      fail(`--tunnel-url must be a valid URL, got "${options.tunnelUrl}"`);
    }
  }
  await resolveCredentials({ apiKey: options.apiKey });

  const service = new AgentsApiService();
  const agent = await resolveTargetAgent({ service, agentFlag: options.agent });
  rememberAgentForDirectory(agent.id);

  // A bring-your-own tunnel forwards straight to the user's own server, so
  // the local auth proxy would sit outside that chain and protect nothing.
  const useAuthProxy = options.auth !== false && !options.tunnelUrl;
  if (options.tunnelUrl && options.auth !== false) {
    console.log(
      chalk.gray(
        "Bring-your-own tunnel: the local auth proxy is not used. Your tunnel forwards directly to your server.",
      ),
    );
  }
  const secret = useAuthProxy
    ? crypto.randomBytes(24).toString("base64url")
    : undefined;

  let proxy: AuthProxy | undefined;
  if (useAuthProxy && secret) {
    proxy = await startAuthProxy({ targetUrl: localUrl, secret });
  }
  const tunnelTarget = proxy?.url ?? localUrl;

  let tunnel: TunnelHandle | undefined;
  let tunnelUrl: string;
  if (options.tunnelUrl) {
    tunnelUrl = options.tunnelUrl;
  } else {
    const spinner = createSpinner("Starting Cloudflare quick tunnel...").start();
    try {
      const started = await startQuickTunnel({ localUrl: tunnelTarget });
      tunnel = started.tunnel;
      tunnelUrl = started.url;
      spinner.succeed(`Tunnel ready at ${tunnelUrl}`);
    } catch (error) {
      failSpinner({ spinner, error, action: "start the tunnel" });
      await proxy?.close();
      process.exit(1);
    }
  }

  const updateUrl = options.updateUrl !== false;
  let previousUrl: string | undefined;
  let needsRestore = false;

  if (updateUrl) {
    const spinner = createSpinner(
      `Pointing agent "${agent.name}" at the tunnel...`,
    ).start();
    try {
      const fresh = await service.get(agent.id);
      const config = applyDevTunnel({
        config: fresh.config ?? {},
        tunnelUrl,
        secret,
      });
      previousUrl = (config.devTunnel as { previousUrl?: string }).previousUrl;
      await service.update(agent.id, { config });
      needsRestore = true;
      spinner.succeed(`Agent "${agent.name}" now points at the tunnel`);
    } catch (error) {
      failSpinner({ spinner, error, action: "update the agent URL" });
      tunnel?.stop();
      await proxy?.close();
      process.exit(1);
    }
  }

  printBanner({ tunnelUrl, localUrl, agent, previousUrl, updatedUrl: updateUrl });

  let resolveDone: (code: number) => void;
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  let shuttingDown = false;
  const shutdown = async (code = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (needsRestore) {
      needsRestore = false;
      try {
        const fresh = await service.get(agent.id);
        const restored = restoreDevTunnel({ config: fresh.config ?? {} });
        if (restored) {
          await service.update(agent.id, { config: restored });
          console.log(
            `Restored agent "${agent.name}"${
              previousUrl ? ` to ${chalk.cyan(previousUrl)}` : ""
            }.`,
          );
        }
      } catch {
        console.error(
          chalk.yellow(
            `Could not restore the agent URL automatically. Set it back yourself: langwatch agent update ${agent.id} --config '{"url":"${previousUrl ?? "<your agent url>"}"}' (or edit the agent in the UI).`,
          ),
        );
      }
    }

    tunnel?.stop();
    await proxy?.close();
    resolveDone(code);
  };

  tunnel?.once("exit", () => {
    if (shuttingDown) return;
    console.error(
      chalk.yellow("The tunnel process ended. Restoring the agent URL."),
    );
    void shutdown(0);
  });

  return { done, shutdown };
}

/**
 * `langwatch agent dev` (alias `agent tunnel`): expose a local agent server
 * through a public tunnel and repoint a registered HTTP agent at it, so
 * platform scenarios run against the local process. Ctrl-C restores the
 * previous URL.
 */
export const agentDevCommand = async (
  options: AgentDevOptions,
): Promise<void> => {
  const session = await startAgentDevSession(options);

  process.once("SIGINT", () => void session.shutdown(0));
  process.once("SIGTERM", () => void session.shutdown(0));

  const code = await session.done;
  process.exit(code);
};
