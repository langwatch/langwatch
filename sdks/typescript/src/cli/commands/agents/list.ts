import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  AgentsApiService,
  type AgentResponse,
} from "@/client-sdk/services/agents/agents-api.service";
import { type ResolvedCredentials, resolveCredentials } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Who a personal or host-scoped agent belongs to, empty for a shared one.
 *
 * A personal agent of another person is listed like every other, because two
 * agents of one name are told apart by this column alone. It reads "owner
 * only" so the difference between "you can run this" and "you can see this"
 * is on the row rather than in a later refusal.
 */
export const agentOwnerLabel = (agent: AgentResponse): string => {
  const owner = agent.owner?.name ?? agent.hostLabel ?? "";
  if (agent.selectable === false) {
    return owner ? `${owner} (owner only)` : "owner only";
  }
  return owner;
};

/** The status column: online or offline for a connected agent, empty for the other types. */
export const agentStatusLabel = (agent: AgentResponse): string => agent.status ?? "";

/**
 * Colours one status cell. The table pads the cell to the width of the widest
 * value before it colours it, so the status is read from the trimmed text and
 * the colour is applied to the padded cell, which keeps the columns aligned.
 */
export const agentStatusColor = (value: string): string => {
  const status = value.trim();
  if (status === "online") return chalk.green(value);
  if (status === "offline") return chalk.gray(value);
  return value;
};

export interface ListAgentsOptions {
  /**
   * The name or id of an agent to wait for: the list is read again every few
   * seconds until that agent reports online, and the command fails once the
   * timeout passes without it.
   */
  waitOnline?: string;
  /** How long `--wait-online` waits, in seconds. */
  timeout?: string | number;
}

/** How often the list is read again while waiting. */
const WAIT_POLL_MS = 3000;
/** How long the wait lasts when the caller names no timeout. */
export const DEFAULT_WAIT_SECONDS = 120;

/** The credentials the list was read with, as the timeout line names them. */
function identityOf(credentials: ResolvedCredentials): string {
  switch (credentials.source) {
    case "flag":
      return "the API key given on the command line";
    case "env":
      return "the API key from the environment";
    case "session":
      return "your device login's personal project key";
  }
}

/**
 * What `--wait-online` says when the timeout passes, on stderr in every output
 * format. It names the agent, the wait and the credentials the listing was
 * read with, so the reader is left with the agent process as the thing to
 * look at. It never mentions the login commands: under `--format json` the
 * spinner is silent, and a timeout whose only stderr line is the identity
 * notice with "langwatch login" in it reads as a login failure.
 */
export function waitOnlineTimeoutLine({
  wanted,
  timeoutSeconds,
  credentials,
}: {
  wanted: string;
  timeoutSeconds: number;
  credentials: ResolvedCredentials;
}): string {
  return `No agent named ${wanted} reported online within ${timeoutSeconds} seconds of --wait-online. The listing was read as ${identityOf(credentials)} at ${credentials.endpoint} and answered; the agent process never reported online.`;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** True when the list holds the agent, by name or id, and it reports online. */
const reportsOnline = (agents: AgentResponse[], wanted: string): boolean =>
  agents.some(
    (agent) =>
      (agent.name === wanted || agent.id === wanted) && agent.status === "online",
  );

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). The `table` closure
 * is the human form.
 *
 * With `--wait-online`, the list is read again until the named agent reports
 * online. A process that has just started takes a few seconds to register,
 * and the wait belongs here rather than in a loop the caller writes: the
 * guided onboarding skill used to script its own poll around this command
 * and misread the document it got back, so it gave up on an agent that was
 * online the whole time.
 *
 * @see specs/typescript-sdk/cli-agents.feature
 */
export const listAgentsCommand = async (
  options: ListAgentsOptions = {},
): Promise<CommandResult | void> => {
  const credentials = await resolveCredentials();

  const service = new AgentsApiService();
  const wanted = options.waitOnline?.trim();
  const spinner = createSpinner(
    wanted ? `Waiting for ${wanted} to come online...` : "Fetching agents...",
  ).start();

  try {
    let result = await service.list({ limit: 100 });
    if (wanted) {
      const timeoutSeconds = Number(options.timeout ?? DEFAULT_WAIT_SECONDS);
      const deadline = Date.now() + timeoutSeconds * 1000;
      while (!reportsOnline(result.data, wanted)) {
        if (Date.now() >= deadline) {
          // Not spinner.fail: the spinner is silent under a machine format,
          // and this line has to reach the caller whatever the format.
          spinner.stop();
          console.error(
            waitOnlineTimeoutLine({ wanted, timeoutSeconds, credentials }),
          );
          console.error(
            chalk.gray(
              "Read the process's own output for the reason: an exception at startup, or the SDK's connect line.",
            ),
          );
          process.exit(1);
        }
        await sleep(WAIT_POLL_MS);
        result = await service.list({ limit: 100 });
      }
    }
    const agents = result.data;

    spinner.succeed(
      `Found ${result.pagination.total} agent${result.pagination.total !== 1 ? "s" : ""}`,
    );

    return {
      data: result,
      table: () => {
        if (agents.length === 0) {
          console.log();
          console.log(chalk.gray("No agents found in this project."));
          console.log(chalk.gray("Connect one from code with connectAgent (langwatch/agent), or create an HTTP agent with:"));
          console.log(
            chalk.cyan(
              '  langwatch agent create "My Agent" --type http --config \'{"url":"https://..."}\'',
            ),
          );
          return;
        }

        console.log();

        const tableData = agents.map((agent) => ({
          Name: agent.name,
          Environment: agent.environment ?? "",
          Status: agentStatusLabel(agent),
          Type: agent.type,
          ID: agent.id,
          Owner: agentOwnerLabel(agent),
          Updated: formatRelativeTime(agent.updatedAt),
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "Environment", "Status", "Type", "ID", "Owner", "Updated"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
            Type: chalk.yellow,
            Status: agentStatusColor,
          },
        });

        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan("langwatch agent get <id>")} to view agent details`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch agents" });
    process.exit(1);
  }
};
