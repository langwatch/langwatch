import chalk from "chalk";
import { loadConfig, isLoggedIn, type GovernanceConfig } from "@/cli/utils/governance/config";

/**
 * One line for what the login key reaches: the scope picked at approval,
 * otherwise invisible until a `--project` fails. Nothing is printed when
 * the field is absent -- no reach to state either way.
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
 * One line for what the login key can DO. "Whole organization" states
 * reach, not power: the key's permission list picked at approval, so a
 * covered command's 403 doesn't surprise. Absent when the login predates it.
 */
export const loginKeyPermissionsLine = (
  scope: GovernanceConfig["cli_api_key_scope"],
): string | undefined => {
  if (!scope?.permissions || scope.permissions.length === 0) return undefined;
  return `Permissions:  ${[...scope.permissions].toSorted().join(", ")}`;
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
