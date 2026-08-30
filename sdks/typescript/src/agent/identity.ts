/**
 * Who and where a connected agent is: its environment, its instance identity
 * and the endpoint it connects to. Every read of the machine is defensive, so
 * a locked-down sandbox with no hostname or no passwd entry still connects.
 */

import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { LANGWATCH_SDK_VERSION } from "../internal/constants";
import { resolveEndpoint } from "../internal/endpoint";
import type { RegisterInstance, RegisterSdk } from "./protocol";

export const DEFAULT_ENVIRONMENT = "development";
const ENVIRONMENT_MAX_LENGTH = 32;

/** The environment variables read in order after the explicit option. */
const ENVIRONMENT_VARIABLES = [
  "LANGWATCH_AGENT_ENVIRONMENT",
  "APP_ENV",
  "ENVIRONMENT",
  "NODE_ENV",
] as const;

const isSet = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * An environment name as the platform stores it: lowercase, `[a-z0-9_-]`
 * only, at most 32 characters. Anything else collapses to a dash, and an
 * empty result is the default environment.
 */
export function sanitizeEnvironment(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ENVIRONMENT_MAX_LENGTH)
    .replace(/-+$/g, "");
  return cleaned === "" ? DEFAULT_ENVIRONMENT : cleaned;
}

/**
 * The environment an agent registers under: the explicit option, then
 * `LANGWATCH_AGENT_ENVIRONMENT`, `APP_ENV`, `ENVIRONMENT`, `NODE_ENV`, else
 * `development`.
 */
export function resolveEnvironment({
  explicit,
  env = process.env,
}: {
  explicit?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  if (isSet(explicit)) return sanitizeEnvironment(explicit);
  for (const name of ENVIRONMENT_VARIABLES) {
    const value = env[name];
    if (isSet(value)) return sanitizeEnvironment(value);
  }
  return DEFAULT_ENVIRONMENT;
}

const isTruthy = (value: string | undefined): boolean => {
  if (!isSet(value)) return false;
  const lowered = value.trim().toLowerCase();
  return lowered !== "0" && lowered !== "false" && lowered !== "no" && lowered !== "off";
};

/**
 * Whether the agent connects at all. `LANGWATCH_AGENT_CONNECT=0` (or false)
 * always disables it; the explicit option wins next; otherwise the connection
 * is on, except when `CI` is truthy.
 */
export function resolveEnabled({
  explicit,
  env = process.env,
}: {
  explicit?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const flag = env.LANGWATCH_AGENT_CONNECT;
  if (isSet(flag) && !isTruthy(flag)) return false;
  if (explicit !== undefined) return explicit;
  return !isTruthy(env.CI);
}

/** The instance label: the option, then `LANGWATCH_AGENT_INSTANCE_LABEL`. */
export function resolveInstanceLabel({
  explicit,
  env = process.env,
}: {
  explicit?: string;
  env?: NodeJS.ProcessEnv;
}): string | undefined {
  if (isSet(explicit)) return explicit.trim();
  const fromEnv = env.LANGWATCH_AGENT_INSTANCE_LABEL;
  return isSet(fromEnv) ? fromEnv.trim() : undefined;
}

/** The two reads of the machine, replaceable so a test can make them fail. */
export interface MachineReader {
  hostname: () => string;
  userInfo: () => { username: string };
}

const HOST_LABEL_MAX_LENGTH = 24;

/**
 * A short label for this machine: lowercase, `[a-z0-9-]`, 24 characters.
 *
 * The platform scopes a development agent connected with a project key to
 * this label, and the Python SDK sends the same shape, so one machine reads
 * the same whichever SDK connected it.
 */
export function hostLabel(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/\.(local|lan|home|localdomain)$/i, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HOST_LABEL_MAX_LENGTH);
}

const readHostname = (machine: MachineReader): string => {
  try {
    return hostLabel(machine.hostname());
  } catch {
    return "";
  }
};

const readUsername = (machine: MachineReader): string => {
  try {
    return machine.userInfo().username;
  } catch {
    return "";
  }
};

/** The identity one process announces in `register`, built once. */
export function buildInstance({
  label,
  machine = os,
}: {
  label?: string;
  machine?: MachineReader;
}): RegisterInstance {
  return {
    id: `inst_${randomUUID().replace(/-/g, "")}`,
    hostname: readHostname(machine),
    username: readUsername(machine),
    pid: process.pid,
    startedAt: new Date().toISOString(),
    ...(label ? { label } : {}),
    inFlightCallIds: [],
  };
}

/** The SDK block of `register`. */
export const SDK_IDENTITY: RegisterSdk = {
  name: "langwatch-typescript",
  version: LANGWATCH_SDK_VERSION,
  language: "typescript",
};

export const USER_AGENT = `langwatch-typescript/${LANGWATCH_SDK_VERSION}`;

export const CONNECT_PATH = "/api/agents/connect";

/**
 * The socket URL for an endpoint: `https://app.langwatch.ai` becomes
 * `wss://app.langwatch.ai/api/agents/connect`, `http://localhost:5560`
 * becomes `ws://localhost:5560/api/agents/connect`.
 */
export function resolveConnectUrl(endpoint?: string | null): string {
  const base = resolveEndpoint(endpoint);
  const socketBase = base.replace(/^http(s?):\/\//i, (_match, secure: string) =>
    secure ? "wss://" : "ws://",
  );
  return `${socketBase}${CONNECT_PATH}`;
}

/** The headers the socket opens with. */
export function buildConnectHeaders({
  apiKey,
  projectId,
}: {
  apiKey: string;
  projectId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "User-Agent": USER_AGENT,
  };
  if (isSet(projectId)) headers["X-Project-Id"] = projectId;
  return headers;
}
