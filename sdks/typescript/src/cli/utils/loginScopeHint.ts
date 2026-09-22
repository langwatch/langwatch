/**
 * What a refusal does not say on its own: which permissions the login on this
 * machine actually carries.
 *
 * `langwatch api-keys create` answers 403 to an organization admin, because a
 * CLI login key is minted without `organization:manage` on purpose. The
 * refusal read as though the person lacked the role, so the way out looked
 * like an escalation rather than a re-login, and an agent holding a device
 * login had no way to tell the two apart at all.
 *
 * The login records the slugs it was minted with, so on an authorization
 * failure they are listed back. That turns "you cannot do this" into "this
 * login was not given that", which names a different and reachable fix.
 *
 * Spec: specs/typescript-sdk/cli-projects-api-keys.feature
 */

import { loadConfig } from "./governance/config";

/**
 * The extra line for an authorization failure, or nothing when there is
 * nothing to add: another code, no login on this machine, or a login made
 * before the permissions were recorded. Silence beats a guess here, since a
 * wrong list would send the reader after the wrong fix.
 */
export const loginPermissionsHint = (code: string): string | undefined => {
  if (code !== "unauthorized") return undefined;

  let permissions: string[] | undefined;
  try {
    permissions = loadConfig()?.cli_api_key_scope?.permissions;
  } catch {
    // An unreadable config is not worth a second failure on the error path.
    return undefined;
  }
  if (!permissions?.length) return undefined;

  return `Your login carries ${[...permissions].sort().join(", ")}. A command needing a permission that is not listed there is refused whatever your role is: run \`langwatch login\` again to approve more, or use an API key that already has it.`;
};
