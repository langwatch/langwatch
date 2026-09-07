/**
 * Create or update the Better Stack monitor that greets Langy.
 *
 *   BETTERSTACK_API_TOKEN=... LANGY_BASE_URL=https://app.example.com \
 *   LANGY_API_KEY=... npx tsx scripts/uptime/upsert-langy-greeting-monitor.ts [--dry-run]
 *
 * Idempotent: the monitor is looked up by name; one match is updated in place,
 * none is created, more than one is an error. The monitor's script is read from
 * `langy-greeting.betterstack.js` next to this file, so the monitor never drifts
 * from the repo by hand-editing in the dashboard.
 *
 * Optional environment:
 *   BETTERSTACK_MONITOR_NAME            default "Langy greeting"
 *   BETTERSTACK_REGION                  one of us, eu, as, au; default eu
 *   BETTERSTACK_CHECK_FREQUENCY_SECONDS default 180
 *   BETTERSTACK_TEAM_NAME               required only with a global API token
 *
 * Spec: specs/langy/langy-uptime-greeting-monitor.feature
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertHttpsBaseUrl } from "./langy-greeting-check";

export const BETTERSTACK_API_BASE = "https://uptime.betterstack.com/api/v2";
export const BETTERSTACK_REGIONS = ["us", "eu", "as", "au"] as const;
export const MONITOR_REQUEST_TIMEOUT_SECONDS = 120;
export const DEFAULT_MONITOR_NAME = "Langy greeting";
export const DEFAULT_CHECK_FREQUENCY_SECONDS = 180;
export const REDACTED = "<redacted>";

export type MonitorConfig = {
  name: string;
  region: string;
  checkFrequencySeconds: number;
  langyBaseUrl: string;
  langyApiKey: string;
  teamName?: string;
};

export type MonitorPayload = {
  monitor_type: "playwright";
  pronounceable_name: string;
  scenario_name: string;
  playwright_script: string;
  environment_variables: { LANGY_BASE_URL: string; LANGY_API_KEY: string };
  regions: string[];
  request_timeout: number;
  check_frequency: number;
  team_name?: string;
};

export class ProvisioningError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProvisioningError";
  }
}

export function buildMonitorPayload({
  config,
  script,
}: {
  config: MonitorConfig;
  script: string;
}): MonitorPayload {
  if (!(BETTERSTACK_REGIONS as readonly string[]).includes(config.region)) {
    throw new ProvisioningError(
      `region "${config.region}" is not one of ${BETTERSTACK_REGIONS.join(", ")}`,
    );
  }
  if (!Number.isInteger(config.checkFrequencySeconds)) {
    throw new ProvisioningError("checkFrequencySeconds must be an integer");
  }
  if (config.checkFrequencySeconds < MONITOR_REQUEST_TIMEOUT_SECONDS) {
    throw new ProvisioningError(
      `checkFrequencySeconds (${config.checkFrequencySeconds}) must be at least the request timeout (${MONITOR_REQUEST_TIMEOUT_SECONDS})`,
    );
  }
  if (!config.langyBaseUrl || !config.langyApiKey) {
    throw new ProvisioningError("langyBaseUrl and langyApiKey are required");
  }
  // The key is stored on the monitor and sent as a header from Better Stack's
  // cloud on every check, so an http:// origin leaks it on every check forever.
  try {
    assertHttpsBaseUrl(config.langyBaseUrl);
  } catch (error) {
    throw new ProvisioningError(
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!script.trim()) {
    throw new ProvisioningError("monitor script is empty");
  }
  return {
    monitor_type: "playwright",
    pronounceable_name: config.name,
    scenario_name: config.name,
    playwright_script: script,
    environment_variables: {
      LANGY_BASE_URL: config.langyBaseUrl,
      LANGY_API_KEY: config.langyApiKey,
    },
    // One region on purpose: every check is a real assistant turn, and
    // regions would multiply the load and the noise for no extra signal.
    regions: [config.region],
    request_timeout: MONITOR_REQUEST_TIMEOUT_SECONDS,
    check_frequency: config.checkFrequencySeconds,
    ...(config.teamName ? { team_name: config.teamName } : {}),
  };
}

export function redactPayload(
  payload: MonitorPayload,
): Record<string, unknown> {
  return {
    ...payload,
    environment_variables: {
      ...payload.environment_variables,
      LANGY_API_KEY: REDACTED,
    },
    playwright_script: `<${payload.playwright_script.length} chars from langy-greeting.betterstack.js>`,
  };
}

export type ApiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

type MonitorRow = { id: string; attributes?: { pronounceable_name?: string } };

type ApiCall = { method: string; path: string; body?: unknown };

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function describeApiError({
  parsed,
  text,
}: {
  parsed: unknown;
  text: string;
}): string {
  return parsed && typeof parsed === "object" && "errors" in parsed
    ? JSON.stringify((parsed as { errors: unknown }).errors)
    : text.slice(0, 300);
}

/** The Better Stack Uptime API, bound to one token. */
class UptimeApi {
  private readonly fetch: ApiFetch;
  private readonly token: string;

  constructor({ fetch, token }: { fetch: ApiFetch; token: string }) {
    this.fetch = fetch;
    this.token = token;
  }

  async call({ method, path, body }: ApiCall): Promise<unknown> {
    const response = await this.fetch(`${BETTERSTACK_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const parsed = parseJson(text);
    if (response.status < 200 || response.status >= 300) {
      throw new ProvisioningError(
        `${method} ${path} answered ${response.status}: ${describeApiError({ parsed, text })}`,
        response.status,
      );
    }
    return parsed;
  }

  /** Exact-name matches only: the API's filter is a match, not an equality. */
  async findMonitorsByName({
    name,
    teamName,
  }: {
    name: string;
    teamName?: string;
  }): Promise<MonitorRow[]> {
    const query = new URLSearchParams({ pronounceable_name: name });
    if (teamName) query.set("team_name", teamName);
    const found: MonitorRow[] = [];
    let path: string | null = `/monitors?${query.toString()}`;
    while (path) {
      const page = (await this.call({ method: "GET", path })) as {
        data?: MonitorRow[];
        pagination?: { next?: string | null };
      };
      found.push(
        ...(page.data ?? []).filter(
          (row) => row.attributes?.pronounceable_name === name,
        ),
      );
      const next = page.pagination?.next ?? null;
      path = next ? next.replace(BETTERSTACK_API_BASE, "") : null;
    }
    return found;
  }
}

export type UpsertResult = {
  action: "created" | "updated" | "dry-run";
  id: string | null;
  dashboardUrl: string | null;
};

export async function upsertMonitor(input: {
  fetch: ApiFetch;
  token: string;
  config: MonitorConfig;
  script: string;
  isDryRun: boolean;
  log: (line: string) => void;
}): Promise<UpsertResult> {
  const payload = buildMonitorPayload({
    config: input.config,
    script: input.script,
  });
  const api = new UptimeApi({ fetch: input.fetch, token: input.token });
  const current = await findTheOneMonitor({ api, config: input.config });

  if (input.isDryRun) {
    input.log(
      `dry run: would ${current ? `update monitor ${current.id}` : "create a monitor"} with`,
    );
    input.log(JSON.stringify(redactPayload(payload), null, 2));
    return { action: "dry-run", id: current?.id ?? null, dashboardUrl: null };
  }

  const write: ApiCall = current
    ? { method: "PATCH", path: `/monitors/${current.id}`, body: payload }
    : { method: "POST", path: "/monitors", body: payload };
  const written = (await api.call(write)) as { data?: { id?: string } };
  const id = written.data?.id ?? current?.id ?? null;
  const dashboardUrl = id
    ? `https://uptime.betterstack.com/team/monitors/${id}`
    : null;
  const action = current ? "updated" : "created";
  input.log(
    `${action} monitor ${id ?? "?"} (${input.config.name}) in region ${input.config.region}`,
  );
  if (dashboardUrl) input.log(dashboardUrl);
  return { action, id, dashboardUrl };
}

/** Zero or one monitor by name; two is an error, because guessing is worse. */
async function findTheOneMonitor({
  api,
  config,
}: {
  api: UptimeApi;
  config: MonitorConfig;
}): Promise<MonitorRow | null> {
  const existing = await api.findMonitorsByName({
    name: config.name,
    teamName: config.teamName,
  });
  if (existing.length > 1) {
    throw new ProvisioningError(
      `${existing.length} monitors are named "${config.name}" (ids ${existing.map((m) => m.id).join(", ")}); rename or delete until one remains`,
    );
  }
  return existing[0] ?? null;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new ProvisioningError(`${name} is not set`);
  return value;
}

export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MonitorConfig {
  const frequencyRaw = env.BETTERSTACK_CHECK_FREQUENCY_SECONDS;
  return {
    name: env.BETTERSTACK_MONITOR_NAME || DEFAULT_MONITOR_NAME,
    region: env.BETTERSTACK_REGION || "eu",
    checkFrequencySeconds: frequencyRaw
      ? Number(frequencyRaw)
      : DEFAULT_CHECK_FREQUENCY_SECONDS,
    langyBaseUrl: env.LANGY_BASE_URL ?? "",
    langyApiKey: env.LANGY_API_KEY ?? "",
    ...(env.BETTERSTACK_TEAM_NAME
      ? { teamName: env.BETTERSTACK_TEAM_NAME }
      : {}),
  };
}

export function readMonitorScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "langy-greeting.betterstack.js"), "utf8");
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes("--dry-run");
  const token = requiredEnv("BETTERSTACK_API_TOKEN");
  const result = await upsertMonitor({
    fetch: globalThis.fetch as unknown as ApiFetch,
    token,
    config: configFromEnv(),
    script: readMonitorScript(),
    isDryRun,
    log: (line) => console.log(line),
  });
  if (result.action !== "dry-run" && !result.id) {
    throw new ProvisioningError("monitor written but no id came back");
  }
}

/**
 * A plain compare of argv[1] against import.meta.url is fail-open through a
 * symlink (a .bin shim, a worktree linked into place): the guard declines to
 * run and the process exits 0 having provisioned nothing. Both sides are
 * resolved through realpathSync; a path that does not exist falls back to its
 * lexical form so it stays a mismatch rather than a crash.
 */
export function isEntryModule({
  invokedPath,
  modulePath,
}: {
  invokedPath: string | undefined;
  modulePath: string;
}): boolean {
  if (invokedPath === undefined) return false;
  return realPathOrResolved(invokedPath) === realPathOrResolved(modulePath);
}

function realPathOrResolved(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

if (
  isEntryModule({
    invokedPath: process.argv[1],
    modulePath: fileURLToPath(import.meta.url),
  })
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`upsert-langy-greeting-monitor: ${message}`);
    process.exit(1);
  });
}
