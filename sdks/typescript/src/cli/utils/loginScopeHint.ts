/**
 * Lists the permissions this machine's login carries on an authorization failure: a CLI login key
 * leaves the management permissions out on purpose, and the fix is a re-login, not an escalation. A
 * refusal for any of them names the one re-login that grants it, whichever command was refused.
 * @see specs/typescript-sdk/cli-projects-api-keys.feature
 * @see specs/ai-gateway/per-team-budget-reorganization.feature
 */

import { scopedApiKey } from "@/internal/credentialContext";

import { loadConfig } from "./governance/config";

/**
 * The permissions a CLI login key leaves out unless the login asked for management access. Mirrors
 * `CLI_KEY_MANAGEMENT_PERMISSIONS` in @langwatch/api-key-contract, which the SDK cannot import.
 */
export const LOGIN_MANAGEMENT_PERMISSIONS: readonly string[] = [
  "organization:manage",
  "team:manage",
];

export const MANAGEMENT_RELOGIN_COMMAND = "langwatch login --device --management";

/** The codes a missing permission comes back as, depending on which door refused it. */
const PERMISSION_REFUSAL_CODES = new Set([
  "unauthorized",
  "forbidden",
  "insufficient_permissions",
  "permission_denied",
  "api_key_permission_denied",
]);

/** The login recorded on this machine, when the refused request authenticated with it. */
const loginUsedByThisRequest = (): { permissions: string[] | undefined } | undefined => {
  let permissions: string[] | undefined;
  let loginKey: string | undefined;
  try {
    const cfg = loadConfig();
    permissions = cfg?.cli_api_key_scope?.permissions;
    loginKey = cfg?.cli_api_key?.trim();
  } catch {
    // An unreadable config is not worth a second failure on the error path.
    return undefined;
  }
  if (!loginKey || scopedApiKey() !== loginKey) return undefined;
  return { permissions };
};

/**
 * The extra line for an authorization failure, or nothing when there is nothing true to add. Only
 * when the request used the LOGIN key: `--api-key`/`LANGWATCH_API_KEY` carry permissions never
 * recorded.
 */
export const loginPermissionsHint = (
  code: string,
  meta: Readonly<Record<string, unknown>> = {},
): string | undefined => {
  const refusedPermission = typeof meta.permission === "string" ? meta.permission : undefined;
  const refusedManagement =
    refusedPermission !== undefined &&
    LOGIN_MANAGEMENT_PERMISSIONS.includes(refusedPermission) &&
    PERMISSION_REFUSAL_CODES.has(code);
  if (code !== "unauthorized" && !refusedManagement) return undefined;

  const login = loginUsedByThisRequest();
  if (!login) return undefined;

  // A CLI login leaves the management permissions out unless it was asked
  // for them, so a login without the refused one is the reason, whatever role
  // its owner holds.
  if (refusedManagement) {
    // A login that carries it was refused by its owner's role, which no
    // re-login changes.
    if (login.permissions?.includes(refusedPermission)) return undefined;
    return `Your CLI login does not include management access (${refusedPermission}). Run \`${MANAGEMENT_RELOGIN_COMMAND}\` to add the management access you hold, or use an API key that has ${refusedPermission}.`;
  }

  const { permissions } = login;
  if (!permissions?.length) return undefined;

  return `Your login carries ${[...permissions].toSorted().join(", ")}. A command needing a permission that is not listed there is refused whatever your role is: run \`langwatch login\` again to approve more, or use an API key that already has it.`;
};
