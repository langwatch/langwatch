import chalk from "chalk";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type {
  VirtualKey,
  VirtualKeyBudgetInput,
  VirtualKeyRoutingMode,
  VirtualKeyScope,
  VirtualKeyScopeType,
} from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { normalizeEndpoint } from "@/internal/endpoint";

/**
 * Colour a key's status. `disabled` is the reversible stop and reads amber, so
 * an operator can tell it apart from the terminal `revoked` at a glance.
 */
export function formatStatus(status: VirtualKey["status"]): string {
  if (status === "active") return chalk.green("active");
  if (status === "disabled") return chalk.yellow("disabled");
  return chalk.red("revoked");
}

/**
 * Builds the public UI URL for a VK detail page. VKs live at the org-scoped
 * surface (/gateway/virtual-keys/:id) regardless of scope rows; per-project
 * gateway pages are gone. Honours `LANGWATCH_UI_ENDPOINT` for split hosts.
 */
export function virtualKeyDetailUrl(vkId: string): string {
  const uiOverride = process.env.LANGWATCH_UI_ENDPOINT;
  const base = normalizeEndpoint(uiOverride ?? resolveControlPlaneUrl());
  if (!base) return "";
  return `${base}/gateway/virtual-keys/${encodeURIComponent(vkId)}`;
}

const SCOPE_TYPES: VirtualKeyScopeType[] = ["organization", "team", "project"];

/**
 * Parses a single `--scope <TYPE>:<id>` value into a `VirtualKeyScope`.
 * Accepts organization/team/project (case-insensitive) plus the `org` alias.
 * Throws a single-sentence Error the CLI prints directly, no stack trace.
 */
export function parseScopeArg(raw: string): VirtualKeyScope {
  const trimmed = raw.trim();
  const colon = trimmed.indexOf(":");
  if (colon < 1 || colon === trimmed.length - 1) {
    throw new Error(
      `--scope value "${raw}" must be in the form TYPE:id (e.g. org:acme, team:platform, project:demo)`,
    );
  }
  // Case-insensitive for the human typing it; the wire value is lowercase.
  const typeRaw = trimmed.slice(0, colon).toLowerCase();
  const scopeId = trimmed.slice(colon + 1).trim();
  const scopeType =
    typeRaw === "org" ? "organization" : SCOPE_TYPES.find((type) => type === typeRaw);
  if (!scopeType) {
    throw new Error(`--scope type "${typeRaw}" must be one of org | organization | team | project`);
  }
  if (!scopeId) {
    throw new Error(`--scope value "${raw}" is missing the id after the colon`);
  }
  return { scope_type: scopeType, scope_id: scopeId };
}

/**
 * Format a scope for display in CLI tables / get output: `org:acme`,
 * `team:platform`, etc. Uses the short `org` form for brevity.
 */
export function formatScope(scope: VirtualKeyScope): string {
  const prefix = scope.scope_type === "organization" ? "org" : scope.scope_type;
  return `${prefix}:${scope.scope_id}`;
}

const ROUTING_MODES: VirtualKeyRoutingMode[] = ["none", "fallback_all", "policy"];
const BUDGET_WINDOWS = ["day", "week", "month"] as const;
const BUDGET_BREACHES = ["block", "warn"] as const;

/** Parse a `--routing-mode` value against the allowlist. */
export function parseRoutingModeArg(raw: string): VirtualKeyRoutingMode {
  const mode = raw.toLowerCase();
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
 * Assembles the key's own cap from budget flags, shared by create and
 * update. limit+window travel together, refused here if only one is given.
 * Undefined leaves the cap alone; a value upserts; null archives it.
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
  const window = options.budgetWindow.toLowerCase();
  if (!(BUDGET_WINDOWS as readonly string[]).includes(window)) {
    throw new Error("--budget-window must be one of day | week | month");
  }
  let onBreach: (typeof BUDGET_BREACHES)[number] | undefined;
  if (options.budgetBreach !== undefined) {
    const breach = options.budgetBreach.toLowerCase();
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
