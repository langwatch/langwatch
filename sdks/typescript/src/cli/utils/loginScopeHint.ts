/**
 * Lists the permissions this machine's login carries on an authorization failure: a CLI login key
 * lacks `organization:manage` on purpose, and the fix is a re-login, not an escalation. A refusal
 * for team management names the one re-login that grants it.
 * @see specs/typescript-sdk/cli-projects-api-keys.feature
 * @see specs/ai-gateway/per-team-budget-reorganization.feature
 */

import { scopedApiKey } from "@/internal/credentialContext";

import { loadConfig } from "./governance/config";

const TEAM_MANAGEMENT = "team:manage";

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
  const refusedTeamManagement =
    meta.permission === TEAM_MANAGEMENT && PERMISSION_REFUSAL_CODES.has(code);
  if (code !== "unauthorized" && !refusedTeamManagement) return undefined;

  const login = loginUsedByThisRequest();
  if (!login) return undefined;

  // A CLI login leaves team management out unless it was asked for, so a
  // login without it is the reason, whatever role its owner holds.
  if (refusedTeamManagement) {
    // A login that carries it was refused by its owner's role, which no
    // re-login changes.
    if (login.permissions?.includes(TEAM_MANAGEMENT)) return undefined;
    return "Your CLI login does not include team management. Run `langwatch login --device --manage-teams` to add it (it needs team management in the organization), or use an API key that has team:manage.";
  }

  const { permissions } = login;
  if (!permissions?.length) return undefined;

  return `Your login carries ${[...permissions].toSorted().join(", ")}. A command needing a permission that is not listed there is refused whatever your role is: run \`langwatch login\` again to approve more, or use an API key that already has it.`;
};
