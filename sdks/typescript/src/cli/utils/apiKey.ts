import chalk from "chalk";
import { config } from "dotenv";
import { setResolvedApiKey, setResolvedProjectId } from "@/internal/credentialContext";
import { getEndpoint } from "./endpoint";
import { getOutputFormat, renderErrorAsJson } from "./errorOutput";
import { maybePrintIdentityNotice } from "./identityNotice";
import { type GovernanceConfig, isLoggedIn, loadConfig, saveConfig } from "./governance/config";
import { fetchPersonalProject, SessionApiError } from "./governance/session-api";
import { projectScopeErrorLines, ProjectScopeError, resolveProjectSelector } from "./projectScope";

/**
 * Re-reads the caller's .env for LANGWATCH_* keys only. In the daemon this
 * runs per request in one shared process, so loading the whole file would
 * leak one caller's secrets into another's request. Existing env vars are
 * never overwritten (dotenv semantics).
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
  /**
   * The project the request names, published into the credential context. A
   * user-scoped key needs it (the server resolves the role binding from it);
   * a legacy project key ignores it. Undefined when nothing named a project.
   */
  projectId?: string;
}

/**
 * How long a cached personal-project key is trusted before re-confirming
 * liveness. Bounds how long a stolen `~/.langwatch/config.json` keeps
 * working after device revocation to minutes, not days.
 * Spec: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
export const SESSION_REVALIDATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Resolves credentials in priority order: --api-key flag, then env
 * `LANGWATCH_API_KEY`, then the device session. Publishes into the
 * request-scoped credential store (not `process.env`), so the daemon's
 * concurrent requests — each its own async context — never cross identities;
 * writing to the process-global env instead was the leak this design forbids.
 */
export const resolveCredentials = async (
  opts: { apiKey?: string; project?: string } = {},
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
    const projectId = await applyProjectScope({ project: opts.project });
    setResolvedProjectId(projectId);
    await maybePrintIdentityNotice({
      mode: "api-key",
      apiKey: flagKey,
      endpoint,
    });
    return { apiKey: flagKey, source: "flag", endpoint, projectId };
  }

  // Trimmed for use, not just for the emptiness check: a `.env` written as
  // `LANGWATCH_API_KEY=sk-abc ` would otherwise ship `Bearer sk-abc ` and 401
  // with nothing pointing at the trailing space.
  const envKey = process.env.LANGWATCH_API_KEY?.trim();
  if (envKey) {
    setResolvedApiKey(envKey);
    const projectId = await applyProjectScope({ project: opts.project });
    setResolvedProjectId(projectId);
    await maybePrintIdentityNotice({
      mode: "api-key",
      apiKey: envKey,
      endpoint,
    });
    return { apiKey: envKey, source: "env", endpoint, projectId };
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
    const session = await resolveSessionCredential(cfg);
    if (session) {
      setResolvedApiKey(session.apiKey);
      // `--project` decides the target BEFORE anything is published: the
      // personal project is the default only when no flag says otherwise,
      // and a flag that does not resolve must leave no target behind at all.
      const projectId =
        (await applyProjectScope({ project: opts.project, cfg })) ?? session.projectId;
      setResolvedProjectId(projectId);
      // An explicit --project names the identity on the command line, so
      // there is nothing implicit left to warn about.
      if (opts.project === undefined) {
        await maybePrintIdentityNotice({
          mode: session.isLoginKey ? "device-login-key" : "device",
          apiKey: session.apiKey,
          endpoint,
        });
      }
      return { apiKey: session.apiKey, source: "session", endpoint, projectId };
    }
  }

  return reportMissingCredentials(endpoint);
};

/**
 * Resolve `--project` into the request's target project and publish it.
 *
 * Returns undefined when no flag was given, which leaves whatever the session
 * path already published in place. A value that does not resolve ends the
 * command: there is no safe fallback, since silently running against the
 * personal project would answer a question the user did not ask.
 */
async function applyProjectScope({
  project,
  cfg,
}: {
  project?: string;
  cfg?: GovernanceConfig;
}): Promise<string | undefined> {
  if (project === undefined) return undefined;
  try {
    const projectId = await resolveProjectSelector({
      selector: project,
      cfg,
    });
    return projectId;
  } catch (err) {
    if (err instanceof ProjectScopeError) reportProjectScopeError(err);
    throw err;
  }
}

function reportProjectScopeError(error: ProjectScopeError): never {
  if (getOutputFormat() !== "text") {
    console.log(
      renderErrorAsJson({
        code: error.code,
        kind: error.code,
        message: error.message,
        httpStatus: 0,
        meta: { project: error.project },
        isHandled: true,
        retryable: false,
      }),
    );
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }

  const [headline, ...rest] = projectScopeErrorLines(error);
  console.error(chalk.red(headline));
  for (const line of rest) {
    console.error(line.startsWith("  ") ? chalk.cyan(line) : chalk.gray(line));
  }
  process.exit(1);
}

/**
 * A stored key, trimmed, or undefined when there is nothing usable there.
 * Trimmed for USE, not just for the emptiness check: a hand-edited config
 * would otherwise ship the stray whitespace into the Authorization header.
 */
const trimmedOrUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
};

/** The key a device session authenticates with, and the project it names. */
interface SessionCredential {
  apiKey: string;
  /** The personal project. Undefined only on a session that never cached one. */
  projectId?: string;
  /** True when the credential is the user-scoped login key rather than the
   * personal project's key; the identity notice words the two differently. */
  isLoginKey: boolean;
}

/**
 * The key for a device session. Two keys can be cached, and the login key
 * (`cli_api_key`) wins over the personal-project key when present — using
 * either past `SESSION_REVALIDATE_WINDOW_MS` unconditionally would be the
 * revocation bypass, so each branch below re-confirms or falls back on its
 * own terms (revoked, legacy server predating the endpoint, or offline).
 */
async function resolveSessionCredential(
  cfg: GovernanceConfig,
): Promise<SessionCredential | undefined> {
  const loginKey = trimmedOrUndefined(cfg.cli_api_key);
  const personalKey = trimmedOrUndefined(cfg.personal_project?.api_key);
  // One clock for both: the probe below confirms the SESSION, and the session
  // is what either key's continued validity rests on.
  const cached = loginKey ?? personalKey;
  const validatedAtMs = (cfg.personal_project?.validated_at ?? 0) * 1000;
  const isFresh = !!cached && Date.now() - validatedAtMs < SESSION_REVALIDATE_WINDOW_MS;
  if (isFresh) {
    return {
      apiKey: cached,
      projectId: cfg.personal_project?.id,
      isLoginKey: cached === loginKey,
    };
  }

  try {
    const project = await fetchPersonalProject(cfg);
    if (!project) {
      // Endpoint missing (legacy server). Nothing to revalidate against;
      // trust the cached key and quiet the clock so we don't re-probe every
      // command.
      if (cached) {
        markPersonalProjectValidated(cfg);
        return {
          apiKey: cached,
          projectId: cfg.personal_project?.id,
          isLoginKey: cached === loginKey,
        };
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
    return {
      apiKey: loginKey ?? project.api_key,
      projectId: project.id,
      isLoginKey: loginKey !== undefined,
    };
  } catch (err) {
    if (err instanceof SessionApiError && (err.status === 401 || err.status === 403)) {
      // Session revoked, expired or refused: sever access. Drop both cached
      // keys so the retained config can no longer authenticate. 403 counts
      // the same as 401 — a session the server refuses is one the CLI must
      // stop presenting, whichever status says so. (fetchPersonalProject's
      // refresh path may already have cleared the personal project; this is
      // idempotent.)
      delete cfg.personal_project;
      delete cfg.cli_api_key;
      delete cfg.cli_api_key_scope;
      saveConfig(cfg);
      return undefined;
    }
    // Offline / transient: fall back to the last-known key, but do NOT touch
    // the validation clock, so the next reachable command revalidates.
    return cached
      ? {
          apiKey: cached,
          projectId: cfg.personal_project?.id,
          isLoginKey: cached === loginKey,
        }
      : undefined;
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
 * The human error block, line by line. Exported for tests. Command lines are
 * indented two spaces (the renderer colors them cyan by that prefix) and kept
 * under 80 columns so no terminal wraps one mid-token.
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
        retryable: false,
      }),
    );
    console.error(chalk.red("Error: you're not logged in, and LANGWATCH_API_KEY is not set."));
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
        retryable: false,
      }),
    );
    console.error(chalk.red("Error: LANGWATCH_API_KEY not found."));
    process.exit(1);
  }

  console.error(chalk.red("Error: LANGWATCH_API_KEY not found."));
  console.error(chalk.gray("This command needs an organization-capable API key. Create one at:"));
  console.error(chalk.cyan(`  ${settingsUrl}`));
  console.error(chalk.gray("Then add it to your .env file:"));
  console.error(chalk.cyan("  echo 'LANGWATCH_API_KEY=<your-key>' >> .env"));
  process.exit(1);
};
