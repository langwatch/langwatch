import chalk from "chalk";
import {
  loadConfig,
  isLoggedIn,
  type GovernanceConfig,
} from "@/cli/utils/governance/config";

/**
 * One line for what the login key reaches. The key is minted from the scope
 * the user picked while approving, and that choice is invisible afterwards —
 * a `--project` that fails is otherwise the first sign of it. Nothing is
 * printed when the field is absent: the login predates the feature, or the
 * server does not mint login keys, and either way there is no reach to state.
 */
export const loginKeyScopeLine = (
  scope: GovernanceConfig["cli_api_key_scope"],
): string | undefined => {
  if (!scope) return undefined;
  if (scope.kind === "organization") return "Login key:    whole organization";
  const count = scope.project_ids.length;
  return `Login key:    ${count} project${count === 1 ? "" : "s"}`;
};

/**
 * One line for what the login key can DO. "Whole organization" states reach,
 * not power: the key carries the permission list picked at approval, and a
 * command the list does not cover is refused with a 403 that reads as a
 * surprise when `whoami` never said so. Nothing is printed when the login
 * predates the field.
 */
export const loginKeyPermissionsLine = (
  scope: GovernanceConfig["cli_api_key_scope"],
): string | undefined => {
  if (!scope?.permissions || scope.permissions.length === 0) return undefined;
  return `Permissions:  ${[...scope.permissions].sort().join(", ")}`;
};

/**
 * `langwatch whoami` — prints the device-flow identity persisted at
 * ~/.langwatch/config.json. Mirrors `git config user.name` /
 * `gh auth status` ergonomics.
 */
export const whoamiCommand = async (): Promise<void> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    console.error(
      chalk.yellow(
        "Not logged in. Run `langwatch login --device` to sign in via your company SSO.",
      ),
    );
    process.exit(1);
  }
  if (cfg.user?.email) console.log(`User:         ${cfg.user.email}`);
  if (cfg.user?.name) console.log(`Name:         ${cfg.user.name}`);
  if (cfg.organization?.name) console.log(`Organization: ${cfg.organization.name}`);
  const scopeLine = loginKeyScopeLine(cfg.cli_api_key_scope);
  if (scopeLine) console.log(scopeLine);
  const permissionsLine = loginKeyPermissionsLine(cfg.cli_api_key_scope);
  if (permissionsLine) console.log(permissionsLine);
  console.log(`Gateway:      ${cfg.gateway_url}`);
  console.log(`Dashboard:    ${cfg.control_plane_url}`);
  if (cfg.default_personal_vk?.prefix) {
    console.log(`Personal VK:  ${cfg.default_personal_vk.prefix}…`);
  }
};
