import chalk from "chalk";
import { config } from "dotenv";
import { getEndpoint } from "./endpoint";
import { getOutputFormat, renderErrorAsJson } from "./errorOutput";
import { maybePrintIdentityNotice } from "./identityNotice";
import {
  type GovernanceConfig,
  isLoggedIn,
  loadConfig,
  saveConfig,
} from "./governance/config";
import { fetchPersonalProject } from "./governance/session-api";

/**
 * Re-read the caller's .env, applying only the LANGWATCH_* keys.
 *
 * In-process this is mostly a no-op (index.ts already ran a full
 * `dotenv.config()` at boot — that path is untouched). Under the daemon it
 * runs per request, against the CALLER's cwd, in a long-lived shared process:
 * loading the whole file the way `dotenv.config()` does would stuff unrelated
 * secrets (DATABASE_URL, AWS credentials, …) into that process's memory for
 * every later request to potentially see, contradicting the
 * secret-minimisation the request env allowlist (daemon/eligibility.ts
 * collectForwardedEnv) is built on. The caller's .env therefore contributes
 * the same class of variables the allowlist would have forwarded: the
 * LANGWATCH_* ones — which covers everything the CLI itself reads
 * (LANGWATCH_API_KEY, LANGWATCH_ENDPOINT, LANGWATCH_PROJECT_ID, …).
 *
 * dotenv semantics are preserved: a variable that is already set (the
 * baseline, or the caller's forwarded overlay) is never overwritten.
 */
const loadEnvFileScoped = (): void => {
  // `processEnv: {}` parses the file into a throwaway object instead of
  // straight into process.env, so the filter below decides what lands.
  const parsed = config({ quiet: true, processEnv: {} })?.parsed ?? {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith("LANGWATCH_")) continue;
    // dotenv semantics: an already-set variable is never overwritten.
    process.env[key] ??= value;
  }
};

export interface ResolvedCredentials {
  apiKey: string;
  /** Where the key came from: an explicit argument, the environment /
   * caller's .env, or the stored device session's personal project. */
  source: "flag" | "env" | "session";
  /** Control-plane endpoint the command targets (4-source resolver). */
  endpoint: string;
}

/**
 * The last API key THIS PROCESS materialised into `process.env` from stored
 * state (a resolved device session, or an explicit key argument), as opposed
 * to a value the caller set. The distinction is the daemon's logged-in
 * single-identity boundary (cli/daemon/identity.ts): auth must be resolved
 * PER REQUEST from config.json on disk, so a value this resolver wrote into
 * the process-global env on a previous request must never be read back as if
 * the caller provided it: a logout between two requests would otherwise
 * keep serving the dead session's key. When the env value equals this
 * marker, the resolver goes back to disk; a genuinely caller-provided value
 * (which, per the daemon's identity hashing and window reset, is the only
 * way the env can legitimately differ) wins exactly as before.
 */
let materializedKey: string | undefined;

/**
 * Resolve the credentials an API-calling command runs with, in priority
 * order:
 *
 *   1. an explicit key argument (a command's own --api-key style flag),
 *   2. `LANGWATCH_API_KEY` from the environment or the caller's .env
 *      (scoped load above, so CI and scripts are never surprised),
 *   3. the device session in ~/.langwatch/config.json, which resolves the
 *      PERSONAL PROJECT's API key: shipped by the login exchange, or
 *      lazily exchanged once (and persisted) for sessions that predate it.
 *
 * The winning key (and, when unset, the resolved endpoint) is materialised
 * into `process.env` so every downstream service (they all default to
 * `process.env.LANGWATCH_API_KEY` at construction) picks it up without
 * plumbing changes.
 *
 * On success, prints the one-line identity notice (stderr only, 30-minute
 * suppression, see identityNotice.ts). With no credential anywhere it
 * reports the not-logged-in error and exits 1, structured on stdout for
 * machine callers, prose on stderr for humans.
 *
 * Spec: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
export const resolveCredentials = async (
  opts: { apiKey?: string } = {},
): Promise<ResolvedCredentials> => {
  // Load environment variables from .env file (scoped — see above)
  loadEnvFileScoped();
  const endpoint = getEndpoint();
  // Services read `process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT` and
  // never consult the persisted config, so a config-resolved endpoint must
  // be materialised for them or a self-hosted login's key would be sent to
  // the cloud default. `??=` keeps an explicit env value authoritative,
  // matching the 4-source resolver's order (env above config).
  process.env.LANGWATCH_ENDPOINT ??= endpoint;

  const flagKey = opts.apiKey?.trim();
  if (flagKey) {
    process.env.LANGWATCH_API_KEY = flagKey;
    materializedKey = flagKey;
    await maybePrintIdentityNotice({
      mode: "api-key",
      apiKey: flagKey,
      endpoint,
    });
    return { apiKey: flagKey, source: "flag", endpoint };
  }

  const envKey = process.env.LANGWATCH_API_KEY;
  if (envKey && envKey.trim() !== "" && envKey !== materializedKey) {
    await maybePrintIdentityNotice({
      mode: "api-key",
      apiKey: envKey,
      endpoint,
    });
    return { apiKey: envKey, source: "env", endpoint };
  }

  // Stored state. Re-read from disk on every call, never cached in-process
  // (the daemon identity boundary again; loadConfig is built for this).
  let cfg: GovernanceConfig | undefined;
  try {
    cfg = loadConfig();
  } catch {
    cfg = undefined;
  }
  if (cfg && isLoggedIn(cfg)) {
    const sessionKey = await resolveSessionProjectKey(cfg);
    if (sessionKey) {
      process.env.LANGWATCH_API_KEY = sessionKey;
      materializedKey = sessionKey;
      await maybePrintIdentityNotice({
        mode: "device",
        apiKey: sessionKey,
        endpoint,
      });
      return { apiKey: sessionKey, source: "session", endpoint };
    }
  }

  return reportMissingCredentials(endpoint);
};

/**
 * The personal project key for a live device session: from the config cache
 * when the login exchange delivered it, otherwise one lazy session-
 * authenticated exchange, persisted so it never repeats. Returns undefined
 * when the session cannot resolve a key (revoked session, pre-endpoint
 * server, offline); the caller then falls through to the not-logged-in
 * error, which names `langwatch login` as the fix either way.
 */
async function resolveSessionProjectKey(
  cfg: GovernanceConfig,
): Promise<string | undefined> {
  const cached = cfg.personal_project?.api_key;
  if (cached && cached.trim() !== "") return cached;
  try {
    const project = await fetchPersonalProject(cfg);
    if (!project) return undefined;
    cfg.personal_project = {
      id: project.id,
      slug: project.slug,
      name: project.name,
      api_key: project.api_key,
    };
    saveConfig(cfg);
    return project.api_key;
  } catch {
    return undefined;
  }
}

/** The human error block, line by line. Exported for tests. */
export const missingCredentialsLines = (authUrl: string): string[] => [
  "Error: not logged in and LANGWATCH_API_KEY is not set.",
  "Easiest: langwatch login          (browser sign-in, no key needed)",
  "With a key: langwatch login --api-key <key>   or   echo 'LANGWATCH_API_KEY=<key>' >> .env",
  `Keys live at: ${authUrl}`,
];

function reportMissingCredentials(endpoint: string): never {
  const authUrl = `${endpoint}/authorize`;

  // Machine callers (`-o json`, agent mode) get the structured document on
  // stdout, same contract as every other failure: a `code` to match on beats
  // prose.
  if (getOutputFormat() !== "text") {
    console.log(
      renderErrorAsJson({
        code: "missing_api_key",
        kind: "missing_api_key",
        message:
          "Not logged in and LANGWATCH_API_KEY is not set. Easiest: `langwatch login` (browser sign-in, no key needed). With a key: `langwatch login --api-key <key>` or add LANGWATCH_API_KEY to your .env.",
        httpStatus: 0,
        meta: { authUrl },
        isHandled: true,
      }),
    );
    console.error(
      chalk.red("Error: not logged in and LANGWATCH_API_KEY is not set."),
    );
    process.exit(1);
  }

  const [headline, ...rest] = missingCredentialsLines(authUrl);
  console.error(chalk.red(headline));
  for (const line of rest) {
    console.error(chalk.gray(line));
  }
  process.exit(1);
}
