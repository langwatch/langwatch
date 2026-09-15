import chalk from "chalk";
import { OrganizationApiService } from "@/client-sdk/services/organization/organization-api.service";
import type { CommandResult } from "../../utils/output";
import { orDash, printFacts, runManagement } from "../management/_shared";

/**
 * Read the organization the credential belongs to. The single sign-on fields
 * and the S3 secret are not part of this API, so they are not in the response
 * and not on this screen.
 */
export const getOrganizationCommand = async (): Promise<CommandResult | void> =>
  runManagement({
    action: "fetch the organization",
    pending: "Fetching organization...",
    run: () => new OrganizationApiService().get(),
    succeed: (organization) => `Organization "${chalk.cyan(organization.name)}"`,
    table: (organization) => {
      printFacts([
        ["ID", chalk.gray(organization.id)],
        ["Name", chalk.cyan(organization.name)],
        ["Slug", organization.slug],
        ["Support contact", orDash(organization.supportContact)],
        ["Presence", organization.presenceEnabled ? "enabled" : "disabled"],
        ["Trace sharing", organization.traceSharingEnabled ? "enabled" : "disabled"],
        ["Primary intent", orDash(organization.primaryIntent)],
        ["Storage bucket", orDash(organization.s3Bucket)],
        ["Storage endpoint", orDash(organization.s3Endpoint)],
      ]);
    },
  });
