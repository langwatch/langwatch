import chalk from "chalk";
import fs from "fs";
import {
  OrganizationApiService,
  type InviteInput,
} from "@/client-sdk/services/organization/organization-api.service";
import {
  commandValidationError,
  reportCommandError,
} from "../../utils/errorOutput";
import { formatTable } from "../../utils/formatting";
import {
  composeInvitesFromFlags,
  parseInvitesJson,
} from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import { counted, runManagement, withParsedFlags } from "../management/_shared";

export interface CreateInvitesOptions {
  email?: string[];
  role?: string[];
  team?: string[];
  json?: string;
  file?: string;
  stdin?: boolean;
}

/** Reads all data from stdin as a string (dataset records add precedent). */
const readStdin = (): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });

/**
 * The batch the caller described, whichever way they described it.
 *
 * Repeated flags are the ergonomic form for the common case (a few people onto
 * the same teams); the JSON forms carry per-person team assignments and custom
 * roles. Both produce the same request, so a run that started as flags can be
 * captured as JSON without changing what happens.
 */
const resolveInvites = async (
  options: CreateInvitesOptions,
): Promise<InviteInput[]> => {
  const jsonSources = [options.json, options.file, options.stdin].filter(
    (source) => source !== undefined && source !== false,
  );
  if (jsonSources.length > 1) {
    reportCommandError({
      error: commandValidationError(
        "Pass only one of --json, --file or --stdin.",
      ),
    });
    process.exit(1);
  }

  if (jsonSources.length === 0) {
    return withParsedFlags(() => composeInvitesFromFlags(options));
  }

  let raw: string;
  if (options.file !== undefined) {
    if (!fs.existsSync(options.file)) {
      reportCommandError({
        error: commandValidationError(`File not found: ${options.file}`),
      });
      process.exit(1);
    }
    raw = fs.readFileSync(options.file, "utf-8");
  } else if (options.stdin) {
    raw = await readStdin();
  } else {
    raw = options.json!;
  }

  return withParsedFlags(() => parseInvitesJson(raw));
};

export const createInvitesCommand = async (
  options: CreateInvitesOptions,
): Promise<CommandResult | void> => {
  const invites = await resolveInvites(options);

  return runManagement({
    action: "create invites",
    pending: `Creating ${counted(invites.length, "invite", "invites")}...`,
    run: () => new OrganizationApiService().createInvites({ invites }),
    succeed: (result) =>
      `Created ${counted(result.invites.length, "invite", "invites")}`,
    table: (result) => {
      console.log();
      formatTable({
        data: result.invites.map((invite) => ({
          Email: invite.email,
          Role: invite.role,
          Teams: String(invite.teams.length),
          "Email sent": invite.emailNotSent ? chalk.yellow("no") : chalk.green("yes"),
          Link: invite.inviteUrl,
        })),
        headers: ["Email", "Role", "Teams", "Email sent", "Link"],
        colorMap: { Email: chalk.cyan, Link: chalk.underline },
      });

      if (result.invites.some((invite) => invite.emailNotSent)) {
        console.log();
        console.log(
          chalk.yellow(
            "Some invite emails could not be sent. Share the links above directly.",
          ),
        );
      }
      console.log();
    },
  });
};
