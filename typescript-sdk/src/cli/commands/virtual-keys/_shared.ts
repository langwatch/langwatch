import type { VirtualKeyScope, VirtualKeyScopeType } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
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
