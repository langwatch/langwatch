import chalk from "chalk";
import { config } from "dotenv";

import { isUserScopedApiKey } from "@/internal/api/auth";
import {
  claimProjectEnvIgnoredWarning,
  requestedProject,
  setResolvedApiKey,
  setResolvedProjectId,
} from "@/internal/credentialContext";
import { normalizeEndpoint } from "@/internal/endpoint";

import { getEndpoint } from "./endpoint";
import { getOutputFormat, renderErrorAsJson } from "./errorOutput";
import { type GovernanceConfig, isLoggedIn, loadConfig, saveConfig } from "./governance/config";
import { fetchPersonalProject, SessionApiError } from "./governance/session-api";
import { maybePrintIdentityNotice } from "./identityNotice";
import {
  type BoundKeySource,
  projectScopeErrorLines,
  projectScopeNotSupported,
  ProjectScopeError,
  resolveProjectSelector,
} from "./projectScope";

/**
 * Re-reads the caller's .env for LANGWATCH_* keys only: the daemon runs
 * this per request in one shared process, so loading the whole file would
 * leak secrets across callers. Existing env vars are never overwritten.
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
  /**
   * Where the key came from: an explicit argument, the environment / caller's .env, or the stored
   * device session's personal project.
   */
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
 * liveness -- bounds a stolen config's post-revocation window to minutes.
 * Spec: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
export const SESSION_REVALIDATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Resolves credentials in priority order: --api-key flag, env, then the
 * device session. Publishes into the request-scoped store, not
 * `process.env`, so concurrent daemon requests never cross identities.
 */
export const resolveCredentials = async (
  opts: {
    apiKey?: string;
    project?: string;
  } = {},
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
    const projectId = await applyProjectScope({
      project: opts.project,
      apiKey: flagKey,
      keySource: "flag-key",
    });
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
    const projectId = await applyProjectScope({
      project: opts.project,
      apiKey: envKey,
      keySource: "env-key",
    });
    setResolvedProjectId(projectId);
    await maybePrintIdentityNotice({
      mode: "api-key",
      apiKey: envKey,
      endpoint,
    });
    return { apiKey: envKey, source: "env", endpoint, projectId };
  }

  // A key given by flag or by LANGWATCH_API_KEY belongs to the address the
  // command targets, so it was used above whatever the login says. The login's
  // own key is different: see `loginMadeElsewhere`.
  const elsewhere = loginMadeElsewhere();
  if (elsewhere) return reportLoginMadeElsewhere(elsewhere);

  const session = await resolveFromSession({
    project: opts.project,
    endpoint,
    isLoginKeyRequired: false,
  });
  if (session) return session;

  return reportMissingCredentials(endpoint);
};

/**
 * A person-acting command's credentials: the device session's login key only, never
 * `LANGWATCH_API_KEY`. Nothing when there is no login, it is refused or keyless, or was made
 * elsewhere (`loginMadeElsewhere`).
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 */
export const resolvePersonCredentials = async (): Promise<ResolvedCredentials | undefined> => {
  // The folder's .env still names the endpoint the folder works against.
  loadEnvFileScoped();
  const endpoint = getEndpoint();
  process.env.LANGWATCH_ENDPOINT ??= endpoint;
  return resolveFromSession({ endpoint, isLoginKeyRequired: true });
};

/**
 * An address as its origin (scheme, lower-case host, port), so trivia does not split one address in
 * two. `localhost` and `127.0.0.1` stay two: what answers is the machine's call.
 */
const originOf = (endpoint: string): string | undefined => {
  try {
    return new URL(normalizeEndpoint(endpoint)).origin;
  } catch {
    return undefined;
  }
};

export interface LoginElsewhere {
  /** The address the login on this machine was made against. */
  loginEndpoint: string;
  /** The address the command targets. */
  endpoint: string;
}

/**
 * The two addresses, when the login in `cfg` was made against one and the
 * command targets another. Nothing when there is no login, or when both are
 * one address.
 */
const loginElsewhere = ({
  cfg,
  endpoint,
}: {
  cfg: GovernanceConfig | undefined;
  endpoint: string;
}): LoginElsewhere | undefined => {
  if (!cfg || !isLoggedIn(cfg)) return undefined;
  const loginEndpoint = normalizeEndpoint(cfg.control_plane_url);
  const loginOrigin = originOf(loginEndpoint);
  const isSameAddress = loginOrigin !== undefined && loginOrigin === originOf(endpoint);
  return isSameAddress ? undefined : { loginEndpoint, endpoint };
};

/**
 * The two addresses when the login was made against one and the command targets another
 * (`LANGWATCH_ENDPOINT`). Login keys only go to their issuer; a flag or env key is used as given.
 */
export const loginMadeElsewhere = (): LoginElsewhere | undefined => {
  loadEnvFileScoped();
  let cfg: GovernanceConfig | undefined;
  try {
    cfg = loadConfig();
  } catch {
    cfg = undefined;
  }
  return loginElsewhere({ cfg, endpoint: getEndpoint() });
};

/**
 * What a command says when the login belongs to another address. `outcome` finishes the sentence
 * about the key for a command with something of its own to say, and `canUseApiKey` is off for a
 * command that acts as a person, where a project key is no way out.
 */
export const loginElsewhereMessage = ({
  loginEndpoint,
  endpoint,
  outcome = "",
  canUseApiKey = true,
}: LoginElsewhere & { outcome?: string; canUseApiKey?: boolean }): string =>
  [
    `The login on this machine is for ${loginEndpoint}, and LANGWATCH_ENDPOINT (in the shell or in this folder's .env) points this command at ${endpoint}.`,
    `A login's key is only sent to the address that issued it${outcome}.`,
    `Run \`langwatch login --device\` here to sign in to ${endpoint}, or unset LANGWATCH_ENDPOINT to use the login you have.`,
    ...(canUseApiKey ? [`A key of ${endpoint} in LANGWATCH_API_KEY or --api-key works too.`] : []),
  ].join(" ");

/**
 * The device session's credential, published into the request-scoped store, or nothing when the
 * machine holds no live session. `isLoginKeyRequired` accepts the user-scoped login key only, since
 * the personal project's key carries no person.
 */
async function resolveFromSession({
  project,
  endpoint,
  isLoginKeyRequired,
}: {
  project?: string;
  endpoint: string;
  isLoginKeyRequired: boolean;
}): Promise<ResolvedCredentials | undefined> {
  // Stored state. Re-read from disk on every call, never cached in-process
  // (the daemon identity boundary again; loadConfig is built for this).
  let cfg: GovernanceConfig | undefined;
  try {
    cfg = loadConfig();
  } catch {
    cfg = undefined;
  }
  if (!cfg || !isLoggedIn(cfg)) return undefined;
  // Every key the session holds goes through here, so this is the one place
  // that keeps it with the address that issued it.
  if (loginElsewhere({ cfg, endpoint })) return undefined;
  const session = await resolveSessionCredential(cfg);
  if (!session) return undefined;
  if (isLoginKeyRequired && !session.isLoginKey) return undefined;

  setResolvedApiKey(session.apiKey);
  // `--project` decides the target BEFORE anything is published: the
  // personal project is the default only when no flag says otherwise,
  // and a flag that does not resolve must leave no target behind at all.
  const projectId =
    (await applyProjectScope({
      project,
      cfg,
      apiKey: session.apiKey,
      keySource: "personal-project-login",
    })) ?? session.projectId;
  setResolvedProjectId(projectId);
  // A NAMED project puts the identity on the command line, so there is nothing implicit left to
  // warn about. `LANGWATCH_PROJECT_ID` does not: it is ambient, and this path does not even read it
  // (the personal project answers), so suppressing the notice for it would leave nothing on screen
  // saying which project replied. A command that acts as the person reads no project either way, so
  // the notice about which project it reads would be wrong; that command names its own login.
  if (currentProjectSelector(project)?.source !== "named" && !isLoginKeyRequired) {
    await maybePrintIdentityNotice({
      mode: session.isLoginKey ? "device-login-key" : "device",
      apiKey: session.apiKey,
      endpoint,
    });
  }
  return { apiKey: session.apiKey, source: "session", endpoint, projectId };
}

/** A project the command line or the environment asked this request to run against. */
interface ProjectSelector {
  value: string;
  /**
   * `named` is `--project`: said here and now, so a key that cannot honour it errors. `env` is
   * `LANGWATCH_PROJECT_ID`, ambient, so the same key answers it with a warning.
   */
  source: "named" | "env";
}

/**
 * The project this request was pointed at: `--project` over `LANGWATCH_PROJECT_ID`. Either is a
 * selector (id or slug) resolved here, so an unknown name stops the command instead of answering
 * elsewhere.
 */
const currentProjectSelector = (explicit: string | undefined): ProjectSelector | undefined => {
  const named = (explicit ?? requestedProject())?.trim();
  if (named) return { value: named, source: "named" };
  const fromEnv = process.env.LANGWATCH_PROJECT_ID?.trim();
  if (fromEnv) return { value: fromEnv, source: "env" };
  return undefined;
};

/**
 * Resolves `--project` into the request's target project and publishes it.
 * Undefined leaves the session path's value in place; an unresolvable
 * value ends the command rather than falling back to the personal project.
 */
async function applyProjectScope({
  project,
  cfg,
  apiKey,
  keySource,
}: {
  project?: string;
  cfg?: GovernanceConfig;
  /** The key the request will authenticate with, which decides what it can honour. */
  apiKey?: string;
  /** Where that key came from, which decides what the refusal tells the user. */
  keySource: BoundKeySource;
}): Promise<string | undefined> {
  const selector = currentProjectSelector(project);
  if (!selector) return undefined;

  // A legacy project key encodes its project in the token, so the server reads
  // the project off the key and ignores the one the request names. There is no
  // way to honour the selector, only a way to say so.
  if (apiKey && !isUserScopedApiKey(apiKey)) {
    const refusal = projectScopeNotSupported({
      selector: selector.value,
      keySource,
    });
    if (selector.source === "named") reportProjectScopeError(refusal);
    // Once per request, not once per process: the daemon runs every command
    // of a session in one process, and a warning said once there is one the
    // next caller never sees.
    if (claimProjectEnvIgnoredWarning()) {
      console.error(
        chalk.yellow(
          `Warning: ${refusal.message} LANGWATCH_PROJECT_ID was ignored, and this command ran against the key's own project.`,
        ),
      );
    }
    return undefined;
  }

  // Only a NAMED project is resolved via the listing. LANGWATCH_PROJECT_ID is an id by contract and
  // reaches the auth header unresolved; an id matching nothing is refused by the platform.
  if (selector.source === "env") return undefined;

  try {
    const projectId = await resolveProjectSelector({
      selector: selector.value,
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
  /**
   * True when the credential is the user-scoped login key rather than the personal project's key;
   * the identity notice words the two differently.
   */
  isLoginKey: boolean;
}

/**
 * The key for a device session. The login key (`cli_api_key`) wins over
 * the personal-project key when present; using either past
 * `SESSION_REVALIDATE_WINDOW_MS` unconditionally would be a revocation bypass.
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
      // Session revoked, expired or refused: 403 counts the same as 401.
      // Drop both cached keys so the retained config can no longer
      // authenticate (idempotent -- the refresh path may have cleared one).
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

/**
 * Reset the revalidation clock on the cached personal project (legacy-server path), persisting it.
 * No-op when there is no cached project.
 */
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

/**
 * Ends the command when the login's key would go to another address than its
 * own: structured on stdout for machine callers, prose on stderr for people.
 */
function reportLoginMadeElsewhere(elsewhere: LoginElsewhere): never {
  const message = loginElsewhereMessage(elsewhere);
  if (getOutputFormat() !== "text") {
    console.log(
      renderErrorAsJson({
        code: "login_endpoint_mismatch",
        kind: "login_endpoint_mismatch",
        message,
        httpStatus: 0,
        meta: { ...elsewhere },
        isHandled: true,
        retryable: false,
      }),
    );
  }
  console.error(chalk.red(`Error: ${message}`));
  process.exit(1);
}

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
 * Org-anchored surfaces (webhooks, spend-events) authenticate with the one
 * supported credential, LANGWATCH_API_KEY; a project-scoped key gets a 401
 * from these routes. No separate org-key variable, no client fallback chain.
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
