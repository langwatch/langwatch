/**
 * Shared device-code login: `runUnifiedLoginFlow({ kind })` is canonical
 * (persists to config.json or .env); `runDeviceFlowLogin` is a back-compat wrapper.
 * @see specs/ai-governance/cli-onboarding/login-unified.feature
 */

import * as fs from "node:fs";
import * as path from "node:path";

import chalk from "chalk";
import type { Ora } from "ora";

import { normalizeEndpoint } from "../../../internal/endpoint";
import { rememberProjectName } from "../identityNotice";
import { createSpinner } from "../spinner";
import {
  type BudgetOverviewResponse,
  type CliBootstrapResponse,
  extractLookupIdFromToken,
  getBudgetOverview,
  getCliBootstrap,
  listIngestionKeys,
} from "./cli-api";
import { type GovernanceConfig, displayConfigPath, loadConfig, saveConfig } from "./config";
import {
  type CredentialType,
  DeviceFlowError,
  type ExchangeApiKeyResult,
  type ExchangeDeviceSessionResult,
  pollUntilDone,
  startDeviceCode,
} from "./device-flow";
import { formatLoginCeremony, type LoginCeremonyBudgetLine } from "./login-ceremony";
import { keptWiringLines, refreshTelemetryWiringForLogin } from "./telemetry-refresh";

export interface RunUnifiedLoginOptions {
  /** Credential type to request. Defaults to 'device_session' for back-compat. */
  kind?: CredentialType;
  /** Optional browser override (LANGWATCH_BROWSER also honoured). */
  browser?: string;
  /** Pre-loaded config to mutate; defaults to `loadConfig()`. */
  cfg?: GovernanceConfig;
  /**
   * The login runs as a step of another command: only the address, code, signed-in identity and
   * wiring changes are printed; the rest is left to `langwatch login`.
   */
  isQuiet?: boolean;
  /**
   * `--management`: ask for the CLI key to also carry the management
   * permissions a CLI login leaves out by default. The approval grants only
   * the ones the approving person holds in the organization.
   */
  management?: boolean;
}

export type RunDeviceFlowLoginOptions = Omit<RunUnifiedLoginOptions, "kind">;

type LoginResult = Awaited<ReturnType<typeof pollUntilDone>>;
type DeviceSessionResult = Extract<LoginResult, { kind: "device_session" }>;
type ProjectKeyResult = Exclude<LoginResult, { kind: "device_session" }>;

/** Adopts the server's gateway URL and per-tool path policy, when it sends them. */
function applyBootstrap({
  cfg,
  bootstrap,
}: {
  cfg: GovernanceConfig;
  bootstrap: Awaited<ReturnType<typeof fetchBootstrapSafely>>;
}): void {
  // Pick up the server's authoritative gateway URL. Without this,
  // self-hosted CLI users would see the SaaS default on whoami/login
  // output even though the gateway is local. Reflects `LW_GATEWAY_BASE_URL`
  // or the IS_SAAS-aware fallback; older servers without this field leave
  // the local default in place.
  if (bootstrap?.gatewayUrl) {
    cfg.gateway_url = bootstrap.gatewayUrl;
    saveConfig(cfg);
  }

  // Cache the org's per-tool path policy so the `langwatch <tool>`
  // wrapper gates path selection on the admin's choices offline.
  // Older servers omit the field; the wrapper then falls back to
  // the hardcoded defaults.
  if (bootstrap?.toolPolicies) {
    cfg.tool_policies = bootstrap.toolPolicies;
    saveConfig(cfg);
  }
}

/** Keeps a cached key the platform still lists, and any hand-placed credential. */
function reconcileEntries({ cfg, liveSet }: { cfg: GovernanceConfig; liveSet: Set<string> }): {
  reconciled: GovernanceConfig["default_personal_ingest_keys"];
  changed: boolean;
} {
  const reconciled: GovernanceConfig["default_personal_ingest_keys"] = {};
  let changed = false;
  for (const [sourceType, entry] of Object.entries(cfg.default_personal_ingest_keys ?? {})) {
    const lookupId = extractLookupIdFromToken(entry.secret ?? "");
    if (lookupId === undefined) {
      // Not a personal ik-lw- token: a credential the user placed
      // here by hand. It cannot be matched against the personal
      // listing, so it is kept, never dropped as stale.
      reconciled[sourceType] = entry;
    } else if (liveSet.has(`${sourceType}:${lookupId}`)) {
      reconciled[sourceType] = entry;
    } else {
      // Revoked on the platform — omit from reconciled.
      changed = true;
    }
  }
  return { reconciled, changed };
}

async function reconcileIngestKeys(cfg: GovernanceConfig): Promise<void> {
  const cached = cfg.default_personal_ingest_keys;
  if (!cached || Object.keys(cached).length === 0) return;
  try {
    const liveKeys = await listIngestionKeys(cfg);
    const liveSet = new Set(liveKeys.map((k) => `${k.sourceType}:${k.lookupId}`));
    const { reconciled, changed } = reconcileEntries({ cfg, liveSet });
    if (changed) {
      cfg.default_personal_ingest_keys = reconciled;
      saveConfig(cfg);
    }
  } catch (error) {
    // Network error / older server: keep existing cache untouched
    void error;
  }
}

async function refreshWiringAfterLogin(cfg: GovernanceConfig): Promise<void> {
  try {
    const refresh = await refreshTelemetryWiringForLogin(cfg);
    if (refresh.mintedAny) saveConfig(cfg);
    if (refresh.labels.length > 0) {
      console.log();
      console.log(chalk.gray("  Updated telemetry wiring to point at this login:"));
      for (const label of refresh.labels) {
        console.log(chalk.gray(`  • ${label}`));
      }
    }
    for (const warning of refresh.warnings ?? []) {
      console.warn(chalk.yellow(`  ${warning}`));
    }
    if (refresh.kept) {
      console.log();
      for (const line of keptWiringLines(refresh.kept)) {
        console.log(chalk.gray(`  ${line}`));
      }
    }
  } catch (error) {
    // Wiring refresh is best-effort; the session itself is already saved.
    void error;
  }
}

/**
 * Three states, named rather than nested: undefined means the server predates
 * the overview endpoint, so the ceremony may fall back to the legacy line; an
 * empty list means the member has no gateway access.
 */
function ceremonyBudgetsFrom(
  budgetOverview: Awaited<ReturnType<typeof fetchBudgetOverviewSafely>>,
): LoginCeremonyBudgetLine[] | undefined {
  if (!budgetOverview) {
    return undefined;
  } else if (budgetOverview.gatewayAccess) {
    return budgetOverview.budgets.map((b) => ({
      spentUsd: Number.parseFloat(b.spentUsd) || 0,
      limitUsd: Number.parseFloat(b.limitUsd) || 0,
      window: b.window,
      scopePhrase: b.scopePhrase,
      providerLabel: b.providerLabel,
      resetsAt: b.resetsAt,
    }));
  } else {
    return [];
  }
}

async function completeDeviceSession({
  cfg,
  result,
  spinner,
  isQuiet,
}: {
  cfg: GovernanceConfig;
  result: DeviceSessionResult;
  spinner: Ora;
  isQuiet: boolean;
}): Promise<GovernanceConfig> {
  spinner.succeed(`Logged in as ${result.user.email}`);
  persistDeviceSession(cfg, result);
  saveConfig(cfg);

  const bootstrap = await fetchBootstrapSafely(cfg);

  applyBootstrap({ cfg, bootstrap });

  // Reconcile cached ingestion keys (#4755): after a fresh login, drop
  // any locally cached entries whose token was revoked on the platform.
  // Errors are swallowed — a login must never fail on reconcile; the
  // worst outcome is a stale cache entry that the per-invocation wrapper
  // check will catch anyway.
  await reconcileIngestKeys(cfg);

  // Latest login wins (#6202): telemetry wiring a previous install
  // persisted (claude settings env, codex [otel] block, gemini/opencode
  // shell functions) pointing at a DIFFERENT instance would silently
  // reroute every plain-tool run there. Re-point it at this login now,
  // minting fresh ingest keys where needed. Best-effort: never fails a login.
  await refreshWiringAfterLogin(cfg);

  if (isQuiet) return cfg;

  // Per-budget epilogue data. Every budget that binds this key,
  // labelled with its scope, so the ceremony never presents the
  // whole organization's cap as if it were personal. Null on older
  // servers without the endpoint; the ceremony then falls back to
  // the /bootstrap collapsed line.
  const budgetOverview = await fetchBudgetOverviewSafely(cfg);

  // Three states, named rather than nested: undefined means the
  // server predates the overview endpoint and the ceremony may
  // fall back to the legacy line; an empty list means the member
  // has no gateway access, which renders nothing budget-related
  // and stops the legacy line resurfacing it.
  const ceremonyBudgets = ceremonyBudgetsFrom(budgetOverview);

  console.log();
  const ceremonyLines = formatLoginCeremony({
    email: cfg.user?.email ?? result.user.email,
    organizationName: cfg.organization?.name,
    tools: bootstrap?.tools,
    providers: bootstrap?.providers,
    budget:
      bootstrap?.budget?.monthlyLimitUsd != null
        ? {
            period: bootstrap.budget.period,
            limitUsd: bootstrap.budget.monthlyLimitUsd,
            usedUsd: bootstrap.budget.monthlyUsedUsd,
          }
        : undefined,
    budgets: ceremonyBudgets,
    budgetsUrl: `${cfg.control_plane_url.replace(/\/+$/, "")}/settings/gateway/budgets`,
  });
  for (const line of ceremonyLines) {
    console.log(line);
  }
  console.log();
  console.log(chalk.gray(`  Dashboard: ${cfg.control_plane_url}`));

  return cfg;
}

function completeProjectKey({
  cfg,
  result,
  spinner,
}: {
  cfg: GovernanceConfig;
  result: ProjectKeyResult;
  spinner: Ora;
}): GovernanceConfig {
  // kind === 'api_key' — write to project-local .env (NO copy-paste)
  spinner.succeed(`Connected to project ${chalk.bold(result.project.name)}`);
  // Seed the identity notice's credential-to-project-name cache while the
  // server is telling us the name anyway, so the first api-key notice
  // needs no extra round trip.
  rememberProjectName(result.api_key, result.project.name);
  const envResult = writeApiKeyToEnv(result.api_key);
  console.log();
  console.log(chalk.green("✓ API key saved to .env"));
  if (envResult.created) {
    console.log(chalk.gray(`  • Created .env file at ${envResult.path}`));
  } else if (envResult.updated) {
    console.log(chalk.gray(`  • Updated existing API key in ${envResult.path}`));
  } else {
    console.log(chalk.gray(`  • Added API key to ${envResult.path}`));
  }
  console.log();
  console.log(chalk.gray(`  Project: ${result.project.name} (${result.project.slug})`));
  console.log(chalk.gray(`  Dashboard: ${cfg.control_plane_url}`));
  return cfg;
}

/**
 * Run the canonical device-code login flow end-to-end. Selects what to mint
 * via `kind` (defaults to device_session); the same browser approval
 * ceremony covers both modes, persisting to the right store on success.
 */
export async function runUnifiedLoginFlow(
  opts: RunUnifiedLoginOptions = {},
): Promise<GovernanceConfig> {
  const kind: CredentialType = opts.kind ?? "device_session";
  const cfg = opts.cfg ?? loadConfig();
  const baseUrl = cfg.control_plane_url;
  const isQuiet = opts.isQuiet === true;

  if (!isQuiet) {
    console.log(chalk.blue("🔐 LangWatch login"));
    console.log(chalk.gray(`Control plane: ${baseUrl}`));
    console.log(
      chalk.gray(
        kind === "project_api_key"
          ? "Mode: project SDK API key (will write .env)"
          : `Mode: device session (will write ${displayConfigPath()})`,
      ),
    );
  }

  const dc = await startDeviceCode(
    { baseUrl },
    {
      credentialType: kind,
      management: kind === "device_session" && opts.management === true,
    },
  );
  const verifyURL =
    dc.verification_uri_complete ??
    `${normalizeEndpoint(dc.verification_uri)}?user_code=${encodeURIComponent(dc.user_code)}`;

  console.log();
  console.log(chalk.cyan(`Opening: ${verifyURL}`));
  console.log(
    chalk.gray(
      `If your browser doesn't open, paste the URL above and enter code: ${chalk.bold(dc.user_code)}`,
    ),
  );
  console.log();

  await openInBrowser(verifyURL, opts.browser);

  // discardStdin:false is load-bearing. ora's default (true) flips stdin to
  // raw mode while the spinner runs, so Ctrl+C arrives as a raw 0x03 byte that
  // ora swallows instead of a SIGINT — the wait becomes unkillable. Keeping
  // stdin cooked lets the terminal deliver SIGINT; the handler stops the
  // spinner and exits cleanly so the user can always abort the login wait.
  const spinner = createSpinner({
    text: "Waiting for you to approve in the browser",
    discardStdin: false,
  }).start();
  const onSigint = () => {
    spinner.stop();
    console.log(chalk.gray("\nLogin cancelled."));
    process.exit(130);
  };
  process.once("SIGINT", onSigint);
  try {
    const result = await pollUntilDone({ baseUrl }, dc);
    if (result.kind === "device_session") {
      return await completeDeviceSession({ cfg, result, spinner, isQuiet });
    }
    return completeProjectKey({ cfg, result, spinner });
  } catch (err) {
    spinner.fail();
    if (err instanceof DeviceFlowError) {
      switch (err.kind) {
        case "denied":
          throw new Error("authorization denied — you can retry `langwatch login`");
        case "expired":
          throw new Error("authorization request expired — run `langwatch login` again");
        default:
          throw err;
      }
    }
    throw err;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

/**
 * Back-compat wrapper. New callers should use `runUnifiedLoginFlow`
 * directly with an explicit `kind`.
 */
export async function runDeviceFlowLogin(
  opts: RunDeviceFlowLoginOptions = {},
): Promise<GovernanceConfig> {
  return runUnifiedLoginFlow({ ...opts, kind: "device_session" });
}

/**
 * Whose login is being replaced, when it is a different one; undefined otherwise. Told, not
 * refused: the new identity is only known after browser approval.
 */
export function replacedSessionNotice({
  previous,
  next,
}: {
  previous: Pick<GovernanceConfig, "user" | "organization">;
  next: {
    user: { email?: string };
    organization: { id: string; name?: string; slug?: string };
  };
}): string | undefined {
  const hadOrg = previous.organization?.id;
  if (!hadOrg || hadOrg === next.organization.id) return undefined;

  // The id is the last fallback rather than no name at all: a session stored
  // before the name was recorded would otherwise read as an empty identity
  // being signed out.
  const orgName = (org?: { id?: string; name?: string; slug?: string }) =>
    org?.name ?? org?.slug ?? org?.id;

  const was = [previous.user?.email, orgName(previous.organization)].filter(Boolean).join(" in ");
  const now = [next.user.email, orgName(next.organization)].filter(Boolean).join(" in ");

  return `This replaces the login on this machine: ${was} is signed out, and every command now runs as ${now}.`;
}

function persistDeviceSession(cfg: GovernanceConfig, result: ExchangeDeviceSessionResult): void {
  const replaced = replacedSessionNotice({ previous: cfg, next: result });
  if (replaced) {
    console.log();
    console.log(chalk.yellow(replaced));
  }
  cfg.access_token = result.access_token;
  cfg.refresh_token = result.refresh_token;
  cfg.expires_at = Math.floor(Date.now() / 1000) + result.expires_in;
  cfg.user = {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
  };
  cfg.organization = {
    id: result.organization.id,
    slug: result.organization.slug,
    name: result.organization.name,
  };
  if (result.default_personal_vk) {
    cfg.default_personal_vk = {
      id: result.default_personal_vk.id,
      secret: result.default_personal_vk.secret,
      prefix: result.default_personal_vk.prefix,
    };
  }
  // The personal project's API key is what data commands authenticate with
  // when no LANGWATCH_API_KEY is set, so a device login Just Works with zero
  // env vars. The PREVIOUS login's cached project must be deleted first:
  // kept, its fresh validated_at could authenticate the new session as the
  // prior user until the revalidation window lapsed.
  delete cfg.personal_project;
  if (result.personal_project?.api_key) {
    cfg.personal_project = {
      id: result.personal_project.id,
      slug: result.personal_project.slug,
      name: result.personal_project.name,
      api_key: result.personal_project.api_key,
      // The exchange that just delivered this key proved the session is
      // live, so seed the revalidation clock now.
      validated_at: Math.floor(Date.now() / 1000),
    };
  }
  // The user-scoped login key, and what it reaches. The previous login's key
  // goes first for the same reason its personal project does: it belongs to
  // the user who logged in before, and keeping it would authenticate the new
  // session as them. A server that ships no key leaves both fields absent,
  // which is what puts the resolver back on the personal-project path.
  delete cfg.cli_api_key;
  delete cfg.cli_api_key_scope;
  if (result.cli_api_key) {
    cfg.cli_api_key = result.cli_api_key;
    if (result.cli_api_key_scope) {
      cfg.cli_api_key_scope = {
        kind: result.cli_api_key_scope.kind,
        project_ids: result.cli_api_key_scope.project_ids ?? [],
        ...(Array.isArray(result.cli_api_key_scope.permissions)
          ? { permissions: result.cli_api_key_scope.permissions }
          : {}),
      };
    }
  }
  if (result.endpoint) {
    cfg.control_plane_url = normalizeEndpoint(result.endpoint);
  }
}

interface EnvWriteResult {
  created: boolean;
  updated: boolean;
  path: string;
}

function writeApiKeyToEnv(apiKey: string): EnvWriteResult {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `LANGWATCH_API_KEY=${apiKey}\n`);
    return { created: true, updated: false, path: envPath };
  }
  const content = fs.readFileSync(envPath, "utf-8");
  const lines = content.split("\n");
  let found = false;
  const updatedLines = lines.map((line) => {
    if (line.startsWith("LANGWATCH_API_KEY=")) {
      found = true;
      return `LANGWATCH_API_KEY=${apiKey}`;
    }
    return line;
  });
  if (!found) {
    if (content.endsWith("\n") || content === "") {
      updatedLines.push(`LANGWATCH_API_KEY=${apiKey}`);
    } else {
      updatedLines.push("", `LANGWATCH_API_KEY=${apiKey}`);
    }
  }
  fs.writeFileSync(envPath, updatedLines.join("\n"));
  return { created: false, updated: found, path: envPath };
}

async function fetchBootstrapSafely(cfg: GovernanceConfig): Promise<CliBootstrapResponse | null> {
  try {
    return await getCliBootstrap(cfg);
  } catch {
    return null;
  }
}

/**
 * The login has already succeeded by the time this runs, so the epilogue
 * gets a deadline rather than the user's patience — otherwise a control
 * plane that accepts but never answers would stop the ceremony from printing.
 */
const BUDGET_OVERVIEW_TIMEOUT_MS = 5_000;

async function fetchBudgetOverviewSafely(
  cfg: GovernanceConfig,
): Promise<BudgetOverviewResponse | null> {
  try {
    return await getBudgetOverview(cfg, {
      timeoutMs: BUDGET_OVERVIEW_TIMEOUT_MS,
    });
  } catch {
    // The epilogue is decoration on a login that already succeeded:
    // a timeout, a refused connection or a 5xx all fall back to the
    // legacy collapsed line rather than failing the login.
    return null;
  }
}

async function openInBrowser(url: string, override?: string): Promise<void> {
  const choice = override ?? process.env.LANGWATCH_BROWSER ?? process.env.BROWSER ?? "";
  if (choice === "none") return;
  const open = (await import("open")).default;
  try {
    if (!choice || choice === "default") {
      await open(url);
      return;
    }
    await open(url, { app: { name: choice } });
  } catch (error) {
    // browser failure shouldn't break login — user can paste manually
    void error;
  }
}

// The post-login shell-rc persist offer moved when `langwatch login` became
// auth-only: the device session in config.json is already authoritative, so
// login never edits the shell rc. It now lives in the `langwatch <tool>`
// wrapper (`maybeOfferIngestionShellRcPersist` in shell-rc.ts), firing only
// in ingestion mode.

// Type-only re-exports so callers can import the shapes from this
// module without reaching into device-flow.ts.
export type { ExchangeApiKeyResult, ExchangeDeviceSessionResult };
