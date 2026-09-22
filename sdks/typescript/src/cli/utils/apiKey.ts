import chalk from "chalk";
import { config } from "dotenv";
import { isUserScopedApiKey } from "@/internal/api/auth";
import {
  requestedProject,
  setResolvedApiKey,
  setResolvedProjectId,
} from "@/internal/credentialContext";
import { normalizeEndpoint } from "@/internal/endpoint";
import { getEndpoint } from "./endpoint";
import { getOutputFormat, renderErrorAsJson } from "./errorOutput";
import { maybePrintIdentityNotice } from "./identityNotice";
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
import {
  type BoundKeySource,
  projectScopeErrorLines,
  projectScopeNotSupported,
  ProjectScopeError,
  resolveProjectSelector,
} from "./projectScope";

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
  /**
   * The project the request names, published into the credential context. A
   * user-scoped key needs it (the server resolves the role binding from it);
   * a legacy project key ignores it. Undefined when nothing named a project.
   */
  projectId?: string;
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
 *      user-scoped LOGIN KEY (`cli_api_key`) when the login minted one, and
 *      the PERSONAL PROJECT's API key otherwise: both are shipped by the login
 *      exchange, then periodically re-validated against session liveness (see
 *      below).
 *
 * The session path also decides WHICH PROJECT the request names. The login key
 * carries no project identity, so the server reads it off the request: the
 * personal project by default, or the one `--project <id|slug>` selects. Both
 * the key and the project id go into the request-scoped credential store, and
 * `buildAuthHeaders` turns the pair into `Basic base64(projectId:key)`.
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
      keySource: "supplied-key",
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
      keySource: "supplied-key",
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
 * The credentials of a command that acts as a person: the login key of the
 * device session in ~/.langwatch/config.json, and nothing else.
 *
 * `LANGWATCH_API_KEY` is never the credential here, whether it comes from the
 * folder's .env or from the shell. A project key carries no person, and
 * nothing in a key tells the command line whether a person stands behind it,
 * so the login is the only credential that is known to. The variable is left
 * as it is for the app in the folder and for every other command.
 *
 * Resolves to nothing when the machine has no login, when the server refuses
 * the one it has, when that login holds no login key, or when the login was
 * made against another address than the one the command targets (see
 * `loginMadeElsewhere`).
 *
 * Spec: specs/typescript-sdk/cli-langy-share-control.feature
 */
export const resolvePersonCredentials = async (): Promise<
  ResolvedCredentials | undefined
> => {
  // The folder's .env still names the endpoint the folder works against.
  loadEnvFileScoped();
  const endpoint = getEndpoint();
  process.env.LANGWATCH_ENDPOINT ??= endpoint;
  return resolveFromSession({ endpoint, isLoginKeyRequired: true });
};

/**
 * An address as its origin: scheme, host in lower case and port, so a trailing
 * slash, a capital letter or a spelled-out default port do not make two
 * addresses out of one. `localhost` and `127.0.0.1` stay two addresses: what
 * answers on each is for the machine to decide, not for a string comparison.
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
  const isSameAddress =
    loginOrigin !== undefined && loginOrigin === originOf(endpoint);
  return isSameAddress ? undefined : { loginEndpoint, endpoint };
};

/**
 * The two addresses, when the login on this machine was made against one and
 * the command targets another.
 *
 * `LANGWATCH_ENDPOINT` decides the target, and a folder's .env can set it. The
 * device session's key, whether the login key or the personal project's, was
 * issued by one address and is only ever sent there: a folder that names
 * another address gets no key from the login, whoever wrote its .env. A key
 * given by flag or in `LANGWATCH_API_KEY` is that address's own and is used
 * as given.
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
 * What a command says when the login belongs to another address. `outcome`
 * finishes the sentence about the key for a command with something of its own
 * to say, and `canUseApiKey` is off for a command that acts as a person, where
 * a project key is no way out.
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
    ...(canUseApiKey
      ? [`A key of ${endpoint} in LANGWATCH_API_KEY or --api-key works too.`]
      : []),
  ].join(" ");

/**
 * The device session's credential, published into the request-scoped store,
 * or nothing when the machine holds no live session. `isLoginKeyRequired`
 * accepts the user-scoped login key only, since the personal project's key
 * carries no person.
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
  // A named project puts the identity on the command line, so there is
  // nothing implicit left to warn about. A command that acts as the person
  // reads no project either way, so the notice about which project it reads
  // would be wrong; that command names its own login.
  if (currentProjectSelector(project) === undefined && !isLoginKeyRequired) {
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
   * `named` is `--project`, on this command or any that inherited it: the user
   * said it here and now, so a key that cannot honour it is an error. `env` is
   * `LANGWATCH_PROJECT_ID`, which is ambient and outlives the shell it was set
   * in, so the same key answers it with a warning instead of a failure.
   */
  source: "named" | "env";
}

/**
 * The project this request was pointed at, whoever pointed it.
 *
 * `--project` wins over `LANGWATCH_PROJECT_ID` because it is the narrower
 * statement. Either way the value is a selector, not an id: an id and a slug
 * are both accepted and only the resolver can tell them apart.
 *
 * The variable used to reach `buildAuthHeaders` unresolved, where a
 * user-scoped key put it in the Basic header and a project key dropped it
 * without a word. Reading it HERE gives it one meaning on every path: it names
 * a project, that name is looked up, and a name that resolves to nothing stops
 * the command instead of quietly answering from somewhere else.
 */
const currentProjectSelector = (
  explicit: string | undefined,
): ProjectSelector | undefined => {
  const named = (explicit ?? requestedProject())?.trim();
  if (named) return { value: named, source: "named" };
  const fromEnv = process.env.LANGWATCH_PROJECT_ID?.trim();
  if (fromEnv) return { value: fromEnv, source: "env" };
  return undefined;
};

/** Said once per process: a repeated warning is one the reader stops seeing. */
let warnedProjectEnvIgnored = false;

/**
 * Resolve the named project into the request's target project and publish it.
 *
 * Returns undefined when nothing named a project, which leaves whatever the
 * session path already published in place. A value that does not resolve ends
 * the command: there is no safe fallback, since silently running against the
 * personal project would answer a question the user did not ask.
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
  keySource?: BoundKeySource;
}): Promise<string | undefined> {
  const selector = currentProjectSelector(project);
  if (!selector) return undefined;

  // A legacy project key encodes its project in the token, so the server reads
  // the project off the key and ignores the one the request names. There is no
  // way to honour the selector, only a way to say so.
  if (apiKey && !isUserScopedApiKey(apiKey)) {
    const refusal = projectScopeNotSupported({
      selector: selector.value,
      keySource: keySource ?? "supplied-key",
    });
    if (selector.source === "named") reportProjectScopeError(refusal);
    if (!warnedProjectEnvIgnored) {
      warnedProjectEnvIgnored = true;
      console.error(
        chalk.yellow(
          `Warning: ${refusal.message} LANGWATCH_PROJECT_ID was ignored, and this command ran against the key's own project.`,
        ),
      );
    }
    return undefined;
  }

  // Only a NAMED project is resolved through the project listing.
  // LANGWATCH_PROJECT_ID is an id by contract (it is what a personal access
  // token is documented to need), and it reaches the auth header unresolved
  // exactly as it always has: looking it up would put a project listing in
  // front of every command, and would refuse a key that is allowed to read its
  // own project but not to list the organization's. An id that matches nothing
  // is answered by the platform, which is a refusal the caller can see.
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
 * The key for a device session, gated on session liveness.
 *
 * TWO KEYS CAN BE CACHED, and the login key wins when it is there. The
 * user-scoped `cli_api_key` reaches every project the user selected while
 * approving the login, so `--project` can move a command across projects with
 * it; `personal_project.api_key` reaches exactly one project and is what a
 * server predating the feature ships. Either way the request names the
 * personal project by default, so a login with a login key behaves exactly
 * like one without until a `--project` says otherwise.
 *
 * Both are long-lived credentials rather than session-bound tokens, so using
 * either unconditionally is the revocation bypass: a stolen
 * `~/.langwatch/config.json` would authenticate forever after the device was
 * revoked. The cache is therefore trusted only within
 * `SESSION_REVALIDATE_WINDOW_MS`; past it, every call re-confirms the session
 * through the session-authenticated `GET /api/auth/cli/personal-project`
 * (which fails once Redis has dropped the revoked/expired tokens), and:
 *
 *   - success       : refresh the personal project + validation clock, use it.
 *   - 401 (revoked) : DELETE both cached keys from config and return
 *                     undefined, so the command reports not-logged-in and the
 *                     stolen config is now inert.
 *   - 403 (session refused) : same as 401 — a session the server refuses is
 *                     one the CLI must stop presenting.
 *   - 404 (a server predating the endpoint) : can't revalidate; keep the
 *                     legacy key and reset the clock so old servers still
 *                     "just work" (they have no device-revocation semantics
 *                     to enforce anyway).
 *   - network/other : offline; keep the last-known key WITHOUT resetting the
 *                     clock, so the very next online command revalidates.
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
  const isFresh =
    !!cached && Date.now() - validatedAtMs < SESSION_REVALIDATE_WINDOW_MS;
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
    if (
      err instanceof SessionApiError &&
      (err.status === 401 || err.status === 403)
    ) {
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
      }),
    );
    console.error(
      chalk.red("Error: you're not logged in, and LANGWATCH_API_KEY is not set."),
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
  console.error(chalk.gray("This command needs an organization-capable API key. Create one at:"));
  console.error(chalk.cyan(`  ${settingsUrl}`));
  console.error(chalk.gray("Then add it to your .env file:"));
  console.error(chalk.cyan("  echo 'LANGWATCH_API_KEY=<your-key>' >> .env"));
  process.exit(1);
};