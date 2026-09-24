import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { PortAllocation } from "./ports.ts";

export type EnvOverrides = Partial<Record<string, string>>;

export type EnvScaffoldInput = {
  ports: PortAllocation;
  baseHost?: string;
  overrides?: EnvOverrides;
};

// Stable-across-regenerations keys. Encrypt rows, sign cookies. Persist to
// secrets.json on first scaffold.
const PERSISTENT_SECRET_KEYS = [
  "NEXTAUTH_SECRET",
  "CREDENTIALS_SECRET",
  "API_TOKEN_JWT_SECRET",
  "LW_VIRTUAL_KEY_PEPPER",
  "LW_GATEWAY_INTERNAL_SECRET",
  "LW_GATEWAY_JWT_SECRET",
  // The app and the Langy agent authenticate to each other with this; a
  // regenerated value on one side and not the other makes every turn 401.
  "LANGY_INTERNAL_SECRET",
] as const;

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const b64 = (bytes: number) => randomBytes(bytes).toString("base64");

type PortBoundEnvEntry = {
  /** The value the current port allocation calls for. */
  expected: string;
  /**
   * A user-pointed value (LAN hostname, external store) won't match this
   * shape, so reconcile leaves it alone across port shifts.
   */
  scaffoldShape: RegExp;
};

const LOCALHOST_URL_SHAPE = /^http:\/\/localhost:\d+$/;

/**
 * Every .env key with a port-bound value. buildEnv writes these on
 * scaffold; reconcileEnvFile rewrites them when a later run lands on a
 * different port base, so the app doesn't dial stores from an old slot.
 */
export function portBoundEnv(ports: PortAllocation) {
  const host = `http://localhost:${ports.langwatch}`;
  return {
    BASE_HOST: { expected: host, scaffoldShape: LOCALHOST_URL_SHAPE },
    NEXTAUTH_URL: { expected: host, scaffoldShape: LOCALHOST_URL_SHAPE },
    PORT: { expected: String(ports.langwatch), scaffoldShape: /^\d+$/ },
    DATABASE_URL: {
      expected: `postgresql://langwatch@localhost:${ports.postgres}/langwatch_db?schema=langwatch_db&connection_limit=5`,
      scaffoldShape:
        /^postgresql:\/\/langwatch@localhost:\d+\/langwatch_db\?schema=langwatch_db&connection_limit=5$/,
    },
    REDIS_URL: {
      expected: `redis://localhost:${ports.redis}/0`,
      scaffoldShape: /^redis:\/\/localhost:\d+\/0$/,
    },
    CLICKHOUSE_URL: {
      expected: `http://localhost:${ports.clickhouseHttp}/langwatch`,
      scaffoldShape: /^http:\/\/localhost:\d+\/langwatch$/,
    },
    LANGWATCH_NLP_SERVICE: {
      expected: `http://localhost:${ports.nlp}`,
      scaffoldShape: LOCALHOST_URL_SHAPE,
    },
    LANGEVALS_ENDPOINT: {
      expected: `http://localhost:${ports.langevals}`,
      scaffoldShape: LOCALHOST_URL_SHAPE,
    },
    LANGWATCH_ENDPOINT: { expected: host, scaffoldShape: LOCALHOST_URL_SHAPE },
    LW_GATEWAY_BASE_URL: {
      expected: `http://localhost:${ports.aigateway}`,
      scaffoldShape: LOCALHOST_URL_SHAPE,
    },
    LANGY_AGENT_URL: {
      expected: `http://localhost:${ports.langyagent}`,
      scaffoldShape: LOCALHOST_URL_SHAPE,
    },
  } satisfies Record<string, PortBoundEnvEntry>;
}

/**
 * Builds .env for ~/.langwatch/.env, mirroring the helm chart's "basic"
 * preset: required secrets generated locally, optional integrations left
 * blank for the user to fill in.
 */
export function buildEnv({ ports, baseHost, overrides = {} }: EnvScaffoldInput): string {
  const host = baseHost ?? `http://localhost:${ports.langwatch}`;
  const portBound = portBoundEnv(ports);
  const lines: string[] = [];
  const set = (key: string, value: string) => {
    lines.push(`${key}=${value}`);
  };
  const sectionBreak = (title: string) => {
    lines.push("", `# ${title}`);
  };

  sectionBreak("BASIC CONFIGURATION");
  set("NODE_ENV", "production");
  set("BASE_HOST", host);
  set("NEXTAUTH_URL", host);
  set("PORT", portBound.PORT.expected);
  set("DEBUG", "langwatch:*");

  sectionBreak("AUTHENTICATION");
  set("NEXTAUTH_PROVIDER", "email");
  set("NEXTAUTH_SECRET", b64(32));
  set("CREDENTIALS_SECRET", hex(32));
  set("API_TOKEN_JWT_SECRET", hex(32));

  sectionBreak("DATA STORES (provisioned locally by @langwatch/server)");
  set("DATABASE_URL", portBound.DATABASE_URL.expected);
  set("REDIS_URL", portBound.REDIS_URL.expected);
  set("CLICKHOUSE_URL", portBound.CLICKHOUSE_URL.expected);

  sectionBreak("LANGWATCH INTERNAL SERVICES");
  set("LANGWATCH_NLP_SERVICE", portBound.LANGWATCH_NLP_SERVICE.expected);
  set("LANGEVALS_ENDPOINT", portBound.LANGEVALS_ENDPOINT.expected);
  // LANGWATCH_ENDPOINT is where the engine POSTs evaluator runs and dataset
  // uploads; the default is the cloud app, which 401s for self-host. Pin it
  // to the local app so those calls hit the running stack.
  set("LANGWATCH_ENDPOINT", host);

  sectionBreak("AI GATEWAY");
  set("LW_VIRTUAL_KEY_PEPPER", hex(32));
  set("LW_GATEWAY_INTERNAL_SECRET", hex(32));
  set("LW_GATEWAY_JWT_SECRET", hex(32));
  // Where the gateway is, from the app's side. The gateway process reads
  // the same name to mean the opposite (its own control plane) and sets it
  // explicitly for itself, so this value only ever reaches the app, which
  // hands it out as the OpenAI-compatible base URL for Langy and the CLI.
  set("LW_GATEWAY_BASE_URL", portBound.LW_GATEWAY_BASE_URL.expected);

  sectionBreak("LANGY ASSISTANT");
  // Shared bearer between the app and the agent; see PERSISTENT_SECRET_KEYS.
  set("LANGY_INTERNAL_SECRET", hex(32));
  set("LANGY_AGENT_URL", portBound.LANGY_AGENT_URL.expected);
  // Langy's rollout flag is SYSTEM-scoped and defaults off so the hosted
  // product can open it one cohort at a time. A laptop install is a cohort of
  // one, and it just installed the assistant on purpose.
  set("FEATURE_FLAG_FORCE_ENABLE", "release_langy_enabled");

  sectionBreak("OPTIONAL PIECES — flip one of these and restart the server");
  // These are read by the installer AND by the app, so the same line decides
  // what gets downloaded and what the product says about it.
  set("LANGWATCH_ENABLE_LANGY", "true");
  // The PII detection evaluator ships a ~670MB language model — larger than
  // the rest of the evaluator environment put together. Off by default; the
  // product points anyone who reaches for that evaluator back at this line.
  set("LANGWATCH_ENABLE_PRESIDIO", "false");
  // The language detection evaluator: ~95MB of language models, same deal.
  set("LANGWATCH_ENABLE_LINGUA", "false");

  sectionBreak("ENVIRONMENT");
  set("ENVIRONMENT", "local");

  sectionBreak("MODELS — fill in any provider you want to evaluate against");
  set("OPENAI_API_KEY", "");
  set("ANTHROPIC_API_KEY", "");
  set("AZURE_OPENAI_ENDPOINT", "");
  set("AZURE_OPENAI_API_KEY", "");
  set("GROQ_API_KEY", "");

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else set(key, value);
  }

  return lines.join("\n") + "\n";
}

// Env-file scaffolder. Idempotent; user edits survive across runs.
export function scaffoldEnvFile(
  input: EnvScaffoldInput & { path: string; shouldReconcilePorts?: boolean },
): { written: boolean; path: string; reconciledKeys: string[] } {
  const secretsPath = join(dirname(input.path), "secrets.json");

  if (existsSync(input.path)) {
    // Backfill secrets.json from .env for upgrading users.
    if (!existsSync(secretsPath)) {
      writePersistedSecrets(secretsPath, readFileSync(input.path, "utf8"));
    }
    // Port-bound URLs belong to this run's allocation; the rest of the file
    // stays the user's. Only callers with a real, conflict-checked
    // allocation reconcile — a default-port guess (bare `install`) must not
    // rewrite a shifted install backwards.
    const reconciledKeys = input.shouldReconcilePorts ? reconcileEnvFile(input) : [];
    return { written: false, path: input.path, reconciledKeys };
  }

  mkdirSync(dirname(input.path), { recursive: true });

  // Read previously persisted secrets (from a prior scaffold) and overlay
  // them so a `rm ~/.langwatch/.env; npx ...` doesn't rotate
  // CREDENTIALS_SECRET out from under encrypted postgres rows. The first
  // scaffold writes the sidecar; every later scaffold reuses it.
  const persistedSecrets = readPersistedSecrets(secretsPath);
  const overlay = { ...input.overrides, ...persistedSecrets };

  const body = buildEnv({ ...input, overrides: overlay });
  writeFileSync(input.path, body, { mode: 0o600 });
  writePersistedSecrets(secretsPath, body);
  return { written: true, path: input.path, reconciledKeys: [] };
}

/**
 * Rewrites port-bound URLs to the given allocation. Only values still in
 * their scaffold shape are touched (see portBoundEnv), so a user override
 * survives. Returns the keys it rewrote.
 */
export function reconcileEnvFile(input: { ports: PortAllocation; path: string }): string[] {
  if (!existsSync(input.path)) return [];
  const entries = portBoundEnv(input.ports);
  const lines = readFileSync(input.path, "utf8").split("\n");
  const reconciledKeys: string[] = [];
  for (const [key, entry] of Object.entries(entries)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (idx < 0) continue;
    const value = (lines[idx] as string).slice(key.length + 1);
    if (value === entry.expected) continue;
    if (!entry.scaffoldShape.test(value)) continue;
    lines[idx] = `${key}=${entry.expected}`;
    reconciledKeys.push(key);
  }
  if (reconciledKeys.length > 0) {
    // { mode } on writeFileSync only applies when the OS creates a new
    // file; rewriting an existing one leaves its current permissions
    // untouched. The .env holds secrets, so chmod explicitly rather than
    // trust whatever mode the file already had.
    writeFileSync(input.path, lines.join("\n"), { mode: 0o600 });
    chmodSync(input.path, 0o600);
  }
  return reconciledKeys;
}

function readPersistedSecrets(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const key of PERSISTENT_SECRET_KEYS) {
      const v = parsed[key];
      if (typeof v === "string" && v.length > 0) out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writePersistedSecrets(path: string, envBody: string): void {
  const found: Record<string, string> = {};
  for (const line of envBody.split("\n")) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === undefined || value === undefined) continue;
    if ((PERSISTENT_SECRET_KEYS as readonly string[]).includes(key)) {
      found[key] = value;
    }
  }
  if (Object.keys(found).length === 0) return;
  writeFileSync(path, JSON.stringify(found, null, 2), { mode: 0o600 });
}

const PASSTHROUGH_ENV_KEYS = [
  "OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "VERTEXAI_PROJECT",
  "VERTEXAI_LOCATION",
  "SENDGRID_API_KEY",
  "SENTRY_DSN",
] as const;

/**
 * Snapshot the user's process.env for the keys we propagate to children.
 * Empty values are dropped so they don't override .env defaults.
 */
export function captureUserEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV_KEYS) {
    const value = env[key];
    if (value && value.length > 0) out[key] = value;
  }
  return out;
}
