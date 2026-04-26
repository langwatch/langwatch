import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PortAllocation } from "./ports.ts";

export type EnvOverrides = Partial<Record<string, string>>;

export type EnvScaffoldInput = {
  ports: PortAllocation;
  baseHost?: string;
  overrides?: EnvOverrides;
};

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const b64 = (bytes: number) => randomBytes(bytes).toString("base64");

/**
 * Builds the .env body for ~/.langwatch/.env. Mirrors the helm chart's
 * "basic" preset: every secret that the app refuses to start without is
 * generated locally; every optional integration (OpenAI, Sendgrid, …) is
 * left blank for the user to fill in later. Every URL is keyed off the
 * allocated port table so a `--port-base 5570` shift cascades to every
 * service consistently.
 */
export function buildEnv({ ports, baseHost, overrides = {} }: EnvScaffoldInput): string {
  const host = baseHost ?? `http://localhost:${ports.langwatch}`;
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
  set("PORT", String(ports.langwatch));
  set("DEBUG", "langwatch:*");

  sectionBreak("AUTHENTICATION");
  set("NEXTAUTH_PROVIDER", "email");
  set("NEXTAUTH_SECRET", b64(32));
  set("CREDENTIALS_SECRET", hex(32));
  set("API_TOKEN_JWT_SECRET", hex(32));

  sectionBreak("DATA STORES (provisioned locally by @langwatch/server)");
  set(
    "DATABASE_URL",
    `postgresql://langwatch@localhost:${ports.postgres}/langwatch_db?schema=langwatch_db&connection_limit=5`
  );
  set("REDIS_URL", `redis://localhost:${ports.redis}/0`);
  set("CLICKHOUSE_URL", `http://localhost:${ports.clickhouseHttp}/langwatch`);

  sectionBreak("LANGWATCH INTERNAL SERVICES");
  set("LANGWATCH_NLP_SERVICE", `http://localhost:${ports.nlp}`);
  set("LANGEVALS_ENDPOINT", `http://localhost:${ports.langevals}`);
  set("DISABLE_PII_REDACTION", "true");

  sectionBreak("AI GATEWAY");
  set("LW_VIRTUAL_KEY_PEPPER", hex(32));
  set("LW_GATEWAY_INTERNAL_SECRET", hex(32));
  set("LW_GATEWAY_JWT_SECRET", hex(32));
  set("LW_GATEWAY_BASE_URL", host);

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

/**
 * The env-file scaffolder both the CLI's [2/4] env phase and
 * services/runtime.ts's `scaffoldEnv` call into. Idempotent — once a
 * .env has been written it's never overwritten so the user's edits
 * (e.g. OPENAI_API_KEY) survive across runs.
 *
 * The list of passthrough keys (OPENAI_API_KEY etc.) is intentionally
 * NOT honoured here — those propagate via RuntimeContext.userEnv so the
 * .env file stays free of user secrets. See 04-validation.feature.
 */
export function scaffoldEnvFile(input: EnvScaffoldInput & { path: string }): { written: boolean; path: string } {
  if (existsSync(input.path)) {
    return { written: false, path: input.path };
  }
  mkdirSync(dirname(input.path), { recursive: true });
  writeFileSync(input.path, buildEnv(input), { mode: 0o600 });
  return { written: true, path: input.path };
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
