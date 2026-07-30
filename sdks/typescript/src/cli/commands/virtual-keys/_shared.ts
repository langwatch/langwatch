import type {
  VirtualKeyBudgetInput,
  VirtualKeyRoutingMode,
  VirtualKeyScope,
  VirtualKeyScopeType,
} from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";

/**
 * Build the public-facing LangWatch UI URL for a VK detail page. After the
 * multi-scope refactor (PR #3524), VKs live at the org-scoped settings
 * surface (/settings/gateway/virtual-keys/:id) regardless of their scope
 * rows; the per-project gateway pages are gone. Honours
 * `LANGWATCH_UI_ENDPOINT` for split UI/API hosts.
 */
export function virtualKeyDetailUrl(vkId: string): string {
  const uiOverride = process.env.LANGWATCH_UI_ENDPOINT;
  const base = (uiOverride ?? resolveControlPlaneUrl()).replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/settings/gateway/virtual-keys/${encodeURIComponent(vkId)}`;
}

const SCOPE_TYPES: VirtualKeyScopeType[] = ["ORGANIZATION", "TEAM", "PROJECT"];

/**
 * Parse a single `--scope <TYPE>:<id>` CLI value into a `VirtualKeyScope`.
 * Accepts the canonical ORGANIZATION/TEAM/PROJECT spellings (case-insensitive)
 * plus the friendly ORG alias for `ORGANIZATION`. Throws an Error with a
 * single-sentence message the CLI can print directly so users see what they
 * mistyped without a stack trace.
 */
export function parseScopeArg(raw: string): VirtualKeyScope {
  const trimmed = raw.trim();
  const colon = trimmed.indexOf(":");
  if (colon < 1 || colon === trimmed.length - 1) {
    throw new Error(`--scope value "${raw}" must be in the form TYPE:id (e.g. ORG:acme, TEAM:platform, PROJECT:demo)`);
  }
  const typeRaw = trimmed.slice(0, colon).toUpperCase();
  const scopeId = trimmed.slice(colon + 1).trim();
  const scopeType: VirtualKeyScopeType | null =
    typeRaw === "ORG" ? "ORGANIZATION" :
    (SCOPE_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as VirtualKeyScopeType) :
    null;
  if (!scopeType) {
    throw new Error(`--scope type "${typeRaw}" must be one of ORG | ORGANIZATION | TEAM | PROJECT`);
  }
  if (!scopeId) {
    throw new Error(`--scope value "${raw}" is missing the id after the colon`);
  }
  return { scope_type: scopeType, scope_id: scopeId };
}

/**
 * Format a scope for display in CLI tables / get output: `ORG:acme`,
 * `TEAM:platform`, etc. Uses the short `ORG` form for brevity.
 */
export function formatScope(scope: VirtualKeyScope): string {
  const prefix = scope.scope_type === "ORGANIZATION" ? "ORG" : scope.scope_type;
  return `${prefix}:${scope.scope_id}`;
}

const ROUTING_MODES: VirtualKeyRoutingMode[] = ["NONE", "FALLBACK_ALL", "POLICY"];
const BUDGET_WINDOWS = ["DAY", "WEEK", "MONTH"] as const;
const BUDGET_BREACHES = ["BLOCK", "WARN"] as const;

/** Parse a `--routing-mode` value against the allowlist. */
export function parseRoutingModeArg(raw: string): VirtualKeyRoutingMode {
  const mode = raw.toUpperCase();
  if (!(ROUTING_MODES as readonly string[]).includes(mode)) {
    throw new Error("--routing-mode must be one of none | fallback_all | policy");
  }
  return mode as VirtualKeyRoutingMode;
}

export interface BudgetFlagOptions {
  budgetLimit?: string;
  budgetWindow?: string;
  budgetBreach?: string;
  clearBudget?: boolean;
}

/**
 * Assemble the key's own cap from the budget flags, shared by create and
 * update. The pair limit+window travels together: one without the other
 * is a half-said cap the server would refuse anyway, so refuse it here
 * with a usable message. Undefined leaves the cap alone; a value upserts
 * it; null (from --clear-budget, update only) archives it — mirroring the
 * wire contract exactly.
 */
export function buildBudgetFlags(
  options: BudgetFlagOptions,
): VirtualKeyBudgetInput | null | undefined {
  if (options.clearBudget) {
    if (options.budgetLimit || options.budgetWindow || options.budgetBreach) {
      throw new Error("--clear-budget cannot be combined with the other --budget-* flags");
    }
    return null;
  }
  const anyBudgetFlag =
    options.budgetLimit !== undefined ||
    options.budgetWindow !== undefined ||
    options.budgetBreach !== undefined;
  if (!anyBudgetFlag) return undefined;
  if (!options.budgetLimit || !options.budgetWindow) {
    throw new Error(
      "--budget-limit and --budget-window travel together (e.g. --budget-limit 25 --budget-window month)",
    );
  }
  const window = options.budgetWindow.toUpperCase();
  if (!(BUDGET_WINDOWS as readonly string[]).includes(window)) {
    throw new Error("--budget-window must be one of day | week | month");
  }
  let onBreach: (typeof BUDGET_BREACHES)[number] | undefined;
  if (options.budgetBreach !== undefined) {
    const breach = options.budgetBreach.toUpperCase();
    if (!(BUDGET_BREACHES as readonly string[]).includes(breach)) {
      throw new Error("--budget-breach must be one of block | warn");
    }
    onBreach = breach as (typeof BUDGET_BREACHES)[number];
  }
  return {
    limit_usd: options.budgetLimit,
    window: window as (typeof BUDGET_WINDOWS)[number],
    on_breach: onBreach,
  };
}
