import chalk from "chalk";

import {
  AgentsApiService,
  type AgentResponse,
} from "@/client-sdk/services/agents/agents-api.service";

import { type ResolvedCredentials, resolveCredentials } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { collapseStaleSiblings } from "./collapseAgents";

/**
 * Who a personal or host-scoped agent belongs to, empty for a shared one.
 * Reads "owner only" so "you can run this" versus "you can see this" is on
 * the row rather than in a later refusal.
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
 * The last seen column: "now" while a connected agent is online, otherwise
 * how long ago its last process was seen, and empty for the other types,
 * which have no process to see.
 */
export const agentLastSeenLabel = (agent: AgentResponse): string => {
  if (agent.type !== "connected") return "";
  if (agent.status === "online") return "now";
  return agent.lastSeenAt ? formatRelativeTime(agent.lastSeenAt) : "";
};

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
  /** List every row, including the stale siblings the list leaves out by default. */
  all?: boolean;
}

/**
 * The rows this command ships, not the rows the project has: stale siblings are
 * collapsed unless `--all` asks for every row, and the total counts what ships.
 */
const shownAgents = ({
  agents,
  total,
  all,
}: {
  agents: AgentResponse[];
  total: number;
  all?: boolean;
}): { agents: AgentResponse[]; hidden: number; total: number } => {
  const shown = all ? agents : collapseStaleSiblings({ agents });
  const hidden = agents.length - shown.length;
  return { agents: shown, hidden, total: total - hidden };
};

const foundAgentsLine = ({ total, hidden }: { total: number; hidden: number }): string => {
  const found = `Found ${total} agent${total !== 1 ? "s" : ""}`;
  if (hidden === 0) return found;
  return `${found} (${hidden} stale row${hidden !== 1 ? "s" : ""} hidden, --all lists them)`;
};

const printHiddenRowsNote = (hidden: number): void => {
  if (hidden === 0) return;
  console.log(
    chalk.gray(
      `${hidden} stale row${hidden !== 1 ? "s" : ""} of a name and environment with a newer row hidden; ${chalk.cyan("langwatch agent list --all")} lists every row`,
    ),
  );
};

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
 * What `--wait-online` says on timeout (stderr, every format): the agent, the wait and the
 * credentials used. It never mentions login, which would read as a login failure under `--format
 * json`.
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** True when the list holds the agent, by name or id, and it reports online. */
const reportsOnline = (agents: AgentResponse[], wanted: string): boolean =>
  agents.some(
    (agent) => (agent.name === wanted || agent.id === wanted) && agent.status === "online",
  );

/**
 * Returns the listing rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts).
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
          console.error(waitOnlineTimeoutLine({ wanted, timeoutSeconds, credentials }));
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
    const { agents, hidden, total } = shownAgents({
      agents: result.data,
      total: result.pagination.total,
      all: options.all,
    });

    spinner.succeed(foundAgentsLine({ total, hidden }));

    return {
      data: {
        ...result,
        data: agents,
        pagination: { ...result.pagination, total },
        hiddenStaleRows: hidden,
      },
      table: () => {
        if (agents.length === 0) {
          console.log();
          console.log(chalk.gray("No agents found in this project."));
          console.log(
            chalk.gray(
              "Connect one from code with connectAgent (langwatch/agent), or create an HTTP agent with:",
            ),
          );
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
          "Last seen": agentLastSeenLabel(agent),
          Type: agent.type,
          ID: agent.id,
          Owner: agentOwnerLabel(agent),
          Updated: formatRelativeTime(agent.updatedAt),
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "Environment", "Status", "Last seen", "Type", "ID", "Owner", "Updated"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
            Type: chalk.yellow,
            Status: agentStatusColor,
          },
        });

        console.log();
        console.log(
          chalk.gray(`Use ${chalk.cyan("langwatch agent get <id>")} to view agent details`),
        );
        printHiddenRowsNote(hidden);
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch agents" });
    process.exit(1);
  }
};
