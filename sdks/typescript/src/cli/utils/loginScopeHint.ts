/**
 * Lists the permissions this machine's login carries on an authorization failure: a CLI login key
 * lacks `organization:manage` on purpose, and the fix is a re-login, not an escalation.
 * @see specs/typescript-sdk/cli-projects-api-keys.feature
 */

import { scopedApiKey } from "@/internal/credentialContext";

import { loadConfig } from "./governance/config";

/**
 * The extra line for an authorization failure, or nothing when there is nothing true to add. Only
 * when the request used the LOGIN key: `--api-key`/`LANGWATCH_API_KEY` carry permissions never
 * recorded.
 */
export const loginPermissionsHint = (code: string): string | undefined => {
  if (code !== "unauthorized") return undefined;

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
  if (!permissions?.length) return undefined;
  if (!loginKey || scopedApiKey() !== loginKey) return undefined;

  return `Your login carries ${[...permissions].toSorted().join(", ")}. A command needing a permission that is not listed there is refused whatever your role is: run \`langwatch login\` again to approve more, or use an API key that already has it.`;
};
