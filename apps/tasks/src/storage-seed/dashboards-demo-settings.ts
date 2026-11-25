/**
 * What one dashboards demo run is told by its environment, read before anything is written.
 * The seed is a dev fixture: it refuses a production or SaaS deployment, and any stack endpoint
 * that is not a local host, as the widget fixture seeds do (specs/setup/dev-fixture-seeds.feature).
 */
import type { TasksConfig } from "../config.ts";

const DEFAULT_ENDPOINT = "http://localhost:6560";
const DEFAULT_DAYS = 60;
const MAX_DAYS = 90;
/** Volume per size: small for a quick local run, large to load the stack for performance work. */
const SIZE_SCALE: Readonly<Record<string, number>> = { small: 0.3, medium: 1, large: 6 };
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

export interface DashboardsDemoSettings {
  /** The running stack's app URL, without a trailing slash. */
  endpoint: string;
  days: number;
  size: string;
  /** What each agent's usual daily volume is multiplied by. */
  scale: number;
  /** The member who sees the demo; absent, the local-dev admin. */
  userEmail: string | undefined;
}

/** The endpoint when it names a local host; any other, or one that is no URL, refuses by name. */
function localEndpoint(raw: string): string {
  let hostname: string;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    throw new Error(`Refusing to seed: DASHBOARDS_DEMO_ENDPOINT is not a valid URL (${raw})`);
  }
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!LOCAL_HOSTS.includes(host) && !host.endsWith(".localhost")) {
    throw new Error(
      `Refusing to seed: DASHBOARDS_DEMO_ENDPOINT host "${hostname}" is not local. ` +
        "The dashboards demo only targets localhost, 127.0.0.1, ::1 or *.localhost",
    );
  }
  return raw.replace(/\/$/, "");
}

export function dashboardsDemoSettings({
  environment,
  config,
}: {
  environment: Readonly<Record<string, string | undefined>>;
  config: Pick<TasksConfig, "nodeEnvironment" | "isSaaS">;
}): DashboardsDemoSettings {
  if (config.nodeEnvironment === "production" || config.isSaaS) {
    throw new Error(
      "Refusing to seed: the dashboards demo is a dev fixture and never runs with " +
        "NODE_ENV=production or IS_SAAS set",
    );
  }
  const endpoint = localEndpoint(
    environment.DASHBOARDS_DEMO_ENDPOINT ?? environment.HAVEN_SEED_ENDPOINT ?? DEFAULT_ENDPOINT,
  );
  const days = Number(environment.DASHBOARDS_DEMO_DAYS ?? DEFAULT_DAYS);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error(`DASHBOARDS_DEMO_DAYS must be a whole number from 1 to ${MAX_DAYS}`);
  }
  const size = environment.DASHBOARDS_DEMO_SIZE ?? "medium";
  const scale = SIZE_SCALE[size];
  if (scale === undefined) {
    throw new Error(`DASHBOARDS_DEMO_SIZE must be one of ${Object.keys(SIZE_SCALE).join(", ")}`);
  }

  return { endpoint, days, size, scale, userEmail: environment.DASHBOARDS_DEMO_USER_EMAIL };
}
