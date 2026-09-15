import chalk from "chalk";
import { OrganizationApiService } from "@/client-sdk/services/organization/organization-api.service";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { counted, printEmpty, runManagement } from "../management/_shared";

/**
 * List pending invites. Each carries its acceptance link, because a
 * provisioning run with no email provider still has to hand the person
 * something to open.
 */
export const listInvitesCommand = async (): Promise<CommandResult | void> =>
  runManagement({
    action: "list invites",
    pending: "Fetching invites...",
    run: () => new OrganizationApiService().listInvites(),
    succeed: (result) =>
      `Found ${counted({ count: result.invites.length, singular: "invite", plural: "invites" })}`,
    table: (result) => {
      if (result.invites.length === 0) {
        printEmpty({
          what: "pending invites",
          hint: "langwatch invites create --email person@example.com --role MEMBER --team team_abc:MEMBER",
        });
        return;
      }
      console.log();
      formatTable({
        data: result.invites.map((invite) => ({
          ID: invite.id,
          Email: invite.email,
          Role: invite.role,
          Teams: String(invite.teams.length),
          Status: invite.status,
          Link: invite.inviteUrl,
        })),
        headers: ["ID", "Email", "Role", "Teams", "Status", "Link"],
        colorMap: { ID: chalk.gray, Email: chalk.cyan, Link: chalk.underline },
      });
      console.log();
    },
  });
