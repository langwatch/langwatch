import chalk from "chalk";
import {
  OrganizationApiService,
  type UpdateOrganizationInput,
} from "@/client-sdk/services/organization/organization-api.service";
import {
  commandValidationError,
  reportCommandError,
} from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";
import { orDash, printFacts, runManagement } from "../management/_shared";

export interface UpdateOrganizationOptions {
  name?: string;
  supportContact?: string;
  presenceEnabled?: boolean;
  traceSharingEnabled?: boolean;
}

/**
 * Update the organization profile. Partial: only the flags given are written,
 * and the response is exactly what a subsequent `organization get` returns.
 */
export const updateOrganizationCommand = async (
  options: UpdateOrganizationOptions,
): Promise<CommandResult | void> => {
  const input: UpdateOrganizationInput = {
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.supportContact !== undefined
      ? { supportContact: options.supportContact }
      : {}),
    ...(options.presenceEnabled !== undefined
      ? { presenceEnabled: options.presenceEnabled }
      : {}),
    ...(options.traceSharingEnabled !== undefined
      ? { traceSharingEnabled: options.traceSharingEnabled }
      : {}),
  };

  if (Object.keys(input).length === 0) {
    reportCommandError({
      error: commandValidationError(
        "Nothing to update. Pass at least one of --name, --support-contact, --presence or --trace-sharing.",
      ),
    });
    process.exit(1);
  }

  return runManagement({
    action: "update the organization",
    pending: "Updating organization...",
    run: () => new OrganizationApiService().update(input),
    succeed: (organization) => `Updated organization "${chalk.cyan(organization.name)}"`,
    table: (organization) => {
      printFacts([
        ["Name", chalk.cyan(organization.name)],
        ["Slug", organization.slug],
        ["Support contact", orDash(organization.supportContact)],
        ["Presence", organization.presenceEnabled ? "enabled" : "disabled"],
        [
          "Trace sharing",
          organization.traceSharingEnabled ? "enabled" : "disabled",
        ],
      ]);
    },
  });
};
