import chalk from "chalk";
import { config } from "dotenv";
import { setResolvedApiKey } from "@/internal/credentialContext";
import { getEndpoint } from "./endpoint";
import { getOutputFormat, renderErrorAsJson } from "./errorOutput";
import {
  type GovernanceConfig,
  isLoggedIn,
  loadConfig,
  saveConfig,
} from "./governance/config";
import {
  fetchPersonalProject,
  SessionApiError,
} from "./governance/session-api";
import { maybePrintIdentityNotice } from "./identityNotice";

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
 * How long a device session's cached personal-project key is trusted before
 * the resolver re-confirms the session is still live. The key is a long-lived
 * `Project.apiKey`, not a session-bound token, so trusting it forever would
 * let a stolen `~/.langwatch/config.json` keep working after the device was
 * revoked from /me/devices. Bounding the trust to this window means a
 * server-side revocation severs CLI access within at most this long: past the
 * window every command re-validates through the session-authenticated
 * endpoint and drops the key when the session is gone. Minutes, not days.
 *
 * Spec: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
export const SESSION_REVALIDATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Resolve the credentials an API-calling command runs with, in priority
 * order:
 *
 *   1. an explicit key argument (a command's own --api-key style flag),
 *   2. `LANGWATCH_API_KEY` from the environment or the caller's .env
 *      (scoped load above, so CI and scripts are never surprised),
 *   3. the device session in ~/.langwatch/config.json, which resolves the
 *      PERSONAL PROJECT's API key: shipped by the login exchange, then
 *      periodically re-validated against session liveness (see below).
 *
 * The winning key is published into the request-scoped credential store
 * (internal/credentialContext.ts), NOT the shared `process.env`. Every
 * API-client factory reads that store first, so a service constructed
 * downstream of this call sees only this request's credential; the daemon
 * runs concurrent requests in separate async contexts, so one request can
 * never read another's key. Writing the resolved key to the process-global
 * env instead (the previous shape) was the cross-identity leak the daemon
 * design forbids. The endpoint stays on `process.env` (via `??=`, so a caller
 * value wins): it is resolved deterministically per execution window and
 * window switches are serialized, so it is not identity-sensitive the way the
 * key is.
 *
 * On success, prints the one-line identity notice (stderr only, 30-minute
 * suppression, see identityNotice.ts). With no credential anywhere it reports
 * the not-logged-in error and exits 1, structured on stdout for machine
 * callers, prose on stderr for humans.
 *
 * Spec: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
export const resolveCredentials = async (
  opts: { apiKey?: string } = {},
): Promise<ResolvedCredentials> => {
  // Load environment variables from .env file (scoped, see above)
  loadEnvFileScoped();
  const endpoint = getEndpoint();
  // Services read `process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT`; a
  // config-resolved endpoint must reach them or a self-hosted login's key
  // would be sent to the cloud default. `??=` keeps an explicit env value
  // authoritative, matching the 4-source resolver's order (env above config).
  process.env.LANGWATCH_ENDPOINT ??= endpoint;

  const flagKey = opts.apiKey?.trim();
  if (flagKey) {
    setResolvedApiKey(flagKey);
    await maybePrintIdentityNotice({
      mode: "api-key",
      apiKey: flagKey,
      endpoint,
    });
    return { apiKey: flagKey, source: "flag", endpoint };
  }

  // Trimmed for use, not just for the emptiness check: a `.env` written as
  // `LANGWATCH_API_KEY=sk-abc ` would otherwise ship `Bearer sk-abc ` and 401
  // with nothing pointing at the trailing space.
  const envKey = process.env.LANGWATCH_API_KEY?.trim();
  if (envKey) {
    setResolvedApiKey(envKey);
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
      setResolvedApiKey(sessionKey);
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
 * The personal-project key for a device session, gated on session liveness.
 *
 * The cached key (delivered by the login exchange, or a prior lazy exchange)
 * is a long-lived `Project.apiKey`. Using it unconditionally is the
 * revocation bypass: a config carrying `personal_project.api_key` would
 * authenticate forever even after the device was revoked. So the cache is
 * trusted only within `SESSION_REVALIDATE_WINDOW_MS`; past it, every call
 * re-confirms the session through the session-authenticated
 * `GET /api/auth/cli/personal-project` (which fails once Redis has dropped
 * the revoked/expired tokens), and:
 *
 *   - success       : refresh the key + validation clock, use it.
 *   - 401 (revoked) : DELETE the cached key from config and return undefined,
 *                     so the command reports not-logged-in and the stolen
 *                     config is now inert.
 *   - 404 (a server predating the endpoint) : can't revalidate; keep the
 *                     legacy key and reset the clock so old servers still
 *                     "just work" (they have no device-revocation semantics
 *                     to enforce anyway).
 *   - network/other : offline; keep the last-known key WITHOUT resetting the
 *                     clock, so the very next online command revalidates.
 */
async function resolveSessionProjectKey(
  cfg: GovernanceConfig,
): Promise<string | undefined> {
  const trimmedKey = cfg.personal_project?.api_key?.trim() ?? "";
  const cached: string | undefined =
    trimmedKey.length > 0 ? trimmedKey : undefined;
  const validatedAtMs = (cfg.personal_project?.validated_at ?? 0) * 1000;
  const fresh =
    !!cached && Date.now() - validatedAtMs < SESSION_REVALIDATE_WINDOW_MS;
  if (fresh) return cached;

  try {
    const project = await fetchPersonalProject(cfg);
    if (!project) {
      // Endpoint missing (legacy server). Nothing to revalidate against;
      // trust the cached key and quiet the clock so we don't re-probe every
      // command.
      if (cached) {
        markPersonalProjectValidated(cfg);
        return cached;
      }
      return undefined;
    }
    cfg.personal_project = {
      id: project.id,
      slug: project.slug,
      name: project.name,
      api_key: project.api_key,
      validated_at: Math.floor(Date.now() / 1000),
    };
    saveConfig(cfg);
    return project.api_key;
  } catch (err) {
    if (err instanceof SessionApiError && err.status === 401) {
      // Session revoked or expired: sever access. Drop the cached key so the
      // retained config can no longer authenticate. (fetchPersonalProject's
      // refresh path may already have cleared it; this is idempotent.)
      delete cfg.personal_project;
      saveConfig(cfg);
      return undefined;
    }
    // Offline / transient: fall back to the last-known key, but do NOT touch
    // the validation clock, so the next reachable command revalidates.
    return cached;
  }
}

/** Reset the revalidation clock on the cached personal project (legacy-server
 * path), persisting it. No-op when there is no cached project. */
function markPersonalProjectValidated(cfg: GovernanceConfig): void {
  if (!cfg.personal_project) return;
  cfg.personal_project = {
    ...cfg.personal_project,
    validated_at: Math.floor(Date.now() / 1000),
  };
  saveConfig(cfg);
}

/**
 * The human error block, line by line. Exported for tests.
 *
 * Shape: what is wrong, the browser sign-in as the primary fix, the API-key
 * alternative, where a key is created, then the agent-facing guardrail.
 * Command lines are indented two spaces (the renderer colors them cyan by
 * that prefix), and no command line exceeds 80 columns, so no terminal wraps
 * one mid-token.
 */
export const missingCredentialsLines = (authUrl: string): string[] => [
  "Error: you're not logged in, and LANGWATCH_API_KEY is not set.",
  "",
  "Sign in with your browser, interactively:",
  "  langwatch login",
  "",
  "If you have an API key already, either of these works:",
  "  langwatch login --api-key <key>",
  "  echo 'LANGWATCH_API_KEY=<key>' >> .env",
  "",
  `Create an API key at ${authUrl}`,
  "",
  "For agents: don't reuse keys outside the project folder, check more options with `langwatch login --help` to help the user",
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
          "Not logged in and LANGWATCH_API_KEY is not set. Sign in interactively with `langwatch login`, pass `--api-key <key>`, or add LANGWATCH_API_KEY to your .env. Don't reuse keys outside the project folder; check more options with `langwatch login --help` to help the user.",
        httpStatus: 0,
        meta: { authUrl },
        isHandled: true,
      }),
    );
    console.error(
      chalk.red(
        "Error: you're not logged in, and LANGWATCH_API_KEY is not set.",
      ),
    );
    process.exit(1);
  }

  const [headline, ...rest] = missingCredentialsLines(authUrl);
  console.error(chalk.red(headline));
  for (const line of rest) {
    console.error(line.startsWith("  ") ? chalk.cyan(line) : chalk.gray(line));
  }
  process.exit(1);
}

/**
 * Org-anchored surfaces (webhooks, spend-events) authenticate with the ONE
 * supported credential, LANGWATCH_API_KEY, exactly like every other
 * command: org and project permission checks are enforced server-side, and
 * a project-scoped key gets a 401 from these routes. No separate org-key
 * variable and no client-side fallback chain, per the recorded auth
 * decision.
 */
export const checkOrgApiKey = (): string => {
  loadEnvFileScoped();
  const key = process.env.LANGWATCH_API_KEY;
  if (key && key.trim() !== "") return key;

  const settingsUrl = `${getEndpoint()}/settings/api-keys`;
  if (getOutputFormat() !== "text") {
    console.log(
      renderErrorAsJson({
        code: "missing_api_key",
        kind: "missing_api_key",
        message:
          "LANGWATCH_API_KEY is not set. This command needs an organization-capable API key; create one in Settings > API Keys and add it to your .env file.",
        httpStatus: 0,
        meta: { settingsUrl },
        isHandled: true,
      }),
    );
    console.error(chalk.red("Error: LANGWATCH_API_KEY not found."));
    process.exit(1);
  }

  console.error(chalk.red("Error: LANGWATCH_API_KEY not found."));
  console.error(
    chalk.gray(
      "This command needs an organization-capable API key. Create one at:",
    ),
  );
  console.error(chalk.cyan(`  ${settingsUrl}`));
  console.error(chalk.gray("Then add it to your .env file:"));
  console.error(chalk.cyan("  echo 'LANGWATCH_API_KEY=<your-key>' >> .env"));
  process.exit(1);
};
