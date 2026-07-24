import chalk from "chalk";
import { loadConfig, isLoggedIn } from "@/cli/utils/governance/config";

/**
 * `langwatch whoami` — prints the device-flow identity persisted at
 * ~/.langwatch/config.json. Mirrors `git config user.name` /
 * `gh auth status` ergonomics.
 */
export const whoamiCommand = async (): Promise<void> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    console.error(
      chalk.yellow("Not logged in. Run `langwatch login --device` to sign in via your company SSO."),
    );
    process.exit(1);
  }
  if (cfg.user?.email) console.log(`User:         ${cfg.user.email}`);
  if (cfg.user?.name) console.log(`Name:         ${cfg.user.name}`);
  if (cfg.organization?.name) console.log(`Organization: ${cfg.organization.name}`);
  console.log(`Gateway:      ${cfg.gateway_url}`);
  console.log(`Dashboard:    ${cfg.control_plane_url}`);
  if (cfg.default_personal_vk?.prefix) {
    console.log(`Personal VK:  ${cfg.default_personal_vk.prefix}…`);
  }
};
