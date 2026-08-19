import chalk from "chalk";
import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";
import { instanceAdminService, requireInstanceKey } from "./_shared";

export interface CreateOrganizationOptions {
  name: string;
  slug?: string;
  adminApiKeyName?: string;
  instanceKey?: string;
}

/**
 * Provision an organization on a self-hosted instance, and the org-scoped
 * admin key that everything else is then done with.
 *
 * `data` deliberately includes the admin key's token: it is returned once,
 * here, and the whole point of this command is to hand the next step of an
 * infrastructure-as-code run a working credential.
 */
export const createOrganizationCommand = async (
  options: CreateOrganizationOptions,
): Promise<CommandResult | void> => {
  const instanceKey = requireInstanceKey(options.instanceKey);

  return runManagement({
    requiresCredentials: false,
    action: "create organization",
    pending: `Creating organization "${options.name}"...`,
    run: () =>
      instanceAdminService(instanceKey).create({
        name: options.name,
        ...(options.slug !== undefined ? { slug: options.slug } : {}),
        ...(options.adminApiKeyName !== undefined
          ? { adminApiKeyName: options.adminApiKeyName }
          : {}),
      }),
    succeed: (created) =>
      `Created organization "${chalk.cyan(created.organization.name)}"`,
    table: (created) => {
      console.log();
      console.log(chalk.gray("Organization id:   ") + created.organization.id);
      console.log(
        chalk.gray("Organization slug: ") + created.organization.slug,
      );
      console.log(chalk.gray("Default team:      ") + created.team.name);
      console.log();
      console.log(
        chalk.bold.yellow(
          "⚠  Save the admin API key below NOW. It will not be shown again.",
        ),
      );
      console.log();
      console.log(`  ${chalk.green(created.adminApiKey.token)}`);
      console.log();
      console.log(
        chalk.gray(
          "Use it as LANGWATCH_API_KEY to run the rest of the provisioning with this CLI.",
        ),
      );
      console.log();
    },
  });
};
