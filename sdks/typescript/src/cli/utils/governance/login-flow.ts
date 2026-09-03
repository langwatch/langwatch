/**
 * Shared device-code login implementations. Two entry points:
 *
 *   1. `runUnifiedLoginFlow({ kind })` — the canonical flow used by
 *      `langwatch login` (interactive routes here for both modes). The
 *      same browser-approval ceremony works for either credential type;
 *      only the persist target differs:
 *        kind: 'device_session' → ~/.langwatch/config.json
 *        kind: 'project_api_key' → $CWD/.env (LANGWATCH_API_KEY)
 *      No copy-paste of the credential ever — the server ships it
 *      back to the CLI over the same RFC 8628 poll endpoint.
 *
 *   2. `runDeviceFlowLogin(...)` — back-compat wrapper that calls
 *      `runUnifiedLoginFlow({ kind: 'device_session' })`. Preserved so
 *      `commands/login.ts --device` and `utils/governance/wrapper.ts`
 *      auto-login keep working without churn.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */

import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { normalizeEndpoint } from "../../../internal/endpoint";
import { createSpinner } from "../spinner";
import {
  type BudgetOverviewResponse,
  type CliBootstrapResponse,
  extractLookupIdFromToken,
  getBudgetOverview,
  getCliBootstrap,
  listIngestionKeys,
} from "./cli-api";
import { type GovernanceConfig, loadConfig, saveConfig } from "./config";
import {
  type CredentialType,
  DeviceFlowError,
  type ExchangeApiKeyResult,
  type ExchangeDeviceSessionResult,
  pollUntilDone,
  startDeviceCode,
} from "./device-flow";
import { rememberProjectName } from "../identityNotice";
import { formatLoginCeremony } from "./login-ceremony";
import { refreshTelemetryWiringForLogin } from "./telemetry-refresh";

export interface RunUnifiedLoginOptions {
  /** Credential type to request. Defaults to 'device_session' for back-compat. */
  kind?: CredentialType;
  /** Optional browser override (LANGWATCH_BROWSER also honoured). */
  browser?: string;
  /** Pre-loaded config to mutate; defaults to `loadConfig()`. */
  cfg?: GovernanceConfig;
}

export type RunDeviceFlowLoginOptions = Omit<RunUnifiedLoginOptions, "kind">;

/**
 * Run the canonical device-code login flow end-to-end. Selects what to
 * mint via `kind` (defaults to device_session); the same browser
 * approval ceremony covers both modes. On success, persists to the
 * right store + returns the latest GovernanceConfig.
 */
export async function runUnifiedLoginFlow(
  opts: RunUnifiedLoginOptions = {},
): Promise<GovernanceConfig> {
  const kind: CredentialType = opts.kind ?? "device_session";
  const cfg = opts.cfg ?? loadConfig();
  const baseUrl = cfg.control_plane_url;

  console.log(chalk.blue("🔐 LangWatch login"));
  console.log(chalk.gray(`Control plane: ${baseUrl}`));
  console.log(
    chalk.gray(
      kind === "project_api_key"
        ? "Mode: project SDK API key (will write .env)"
        : "Mode: device session (will write ~/.langwatch/config.json)",
    ),
  );

  const dc = await startDeviceCode({ baseUrl }, { credentialType: kind });
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
      spinner.succeed(`Logged in as ${result.user.email}`);
      persistDeviceSession(cfg, result);
      saveConfig(cfg);

      const bootstrap = await fetchBootstrapSafely(cfg);

      // Pick up the server's authoritative gateway URL. Without this,
      // self-hosted CLI users would see the SaaS default
      // (https://gateway.langwatch.ai) on whoami / login output even
      // though the actual gateway is on localhost:5563. The server's
      // `gatewayUrl` reflects `LW_GATEWAY_BASE_URL` or the IS_SAAS-
      // aware fallback. Backwards-compatible: older servers (without
      // this field) leave the local default in place.
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

      // Reconcile cached ingestion keys (#4755): after a fresh login, drop
      // any locally cached entries whose token was revoked on the platform.
      // Errors are swallowed — a login must never fail on reconcile; the
      // worst outcome is a stale cache entry that the per-invocation wrapper
      // check will catch anyway.
      if (
        cfg.default_personal_ingest_keys &&
        Object.keys(cfg.default_personal_ingest_keys).length > 0
      ) {
        try {
          const liveKeys = await listIngestionKeys(cfg);
          const liveSet = new Set(liveKeys.map((k) => `${k.sourceType}:${k.lookupId}`));
          const reconciled: GovernanceConfig["default_personal_ingest_keys"] = {};
          let changed = false;
          for (const [sourceType, entry] of Object.entries(cfg.default_personal_ingest_keys)) {
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
          if (changed) {
            cfg.default_personal_ingest_keys = reconciled;
            saveConfig(cfg);
          }
        } catch {
          // Network error / older server: keep existing cache untouched
        }
      }

      // Latest login wins (#6202): any langwatch-authored telemetry wiring a
      // previous install persisted (claude settings env, codex [otel] block,
      // gemini/opencode shell functions) that still points at a DIFFERENT
      // instance would silently reroute every plain-tool run there - claude
      // even applies its settings env ON TOP of a wrapper's process env.
      // Re-point it at this login now, minting fresh ingest keys on this
      // instance where needed. Best-effort: a login never fails on this.
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
      } catch {
        // Wiring refresh is best-effort; the session itself is already saved.
      }

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
      const ceremonyBudgets = !budgetOverview
        ? undefined
        : budgetOverview.gatewayAccess
          ? budgetOverview.budgets.map((b) => ({
              spentUsd: Number.parseFloat(b.spentUsd) || 0,
              limitUsd: Number.parseFloat(b.limitUsd) || 0,
              window: b.window,
              scopePhrase: b.scopePhrase,
              providerLabel: b.providerLabel,
              resetsAt: b.resetsAt,
            }))
          : [];

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

function persistDeviceSession(cfg: GovernanceConfig, result: ExchangeDeviceSessionResult): void {
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
  // The personal project's API key is what data commands (`langwatch trace
  // search`, ...) authenticate with when no LANGWATCH_API_KEY is set, so a
  // device login Just Works with zero env vars. Older servers omit the
  // field; the credential resolver then lazily exchanges it once. Either
  // way the PREVIOUS login's cached project must go first: kept, its fresh
  // validated_at could authenticate the new session as the prior user
  // until the revalidation window lapsed.
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
 * gets a deadline rather than the user's patience: a control plane that
 * accepts the connection and never answers would otherwise stop the
 * ceremony from printing at all.
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
  } catch {
    // browser failure shouldn't break login — user can paste manually
  }
}

// The post-login shell-rc persist offer was removed when `langwatch
// login` became auth-only: the device session in config.json is
// already authoritative, so login never edits the shell rc. The
// persist offer now lives in the `langwatch <tool>` wrapper and fires
// only in ingestion mode (maybeOfferIngestionShellRcPersist in
// shell-rc.ts), framed as installing telemetry.

// Type-only re-exports so callers can import the shapes from this
// module without reaching into device-flow.ts.
export type { ExchangeApiKeyResult, ExchangeDeviceSessionResult };
