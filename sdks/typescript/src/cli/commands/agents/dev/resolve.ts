/**
 * Input resolution for a dev tunnel session: which local URL to expose and
 * which registered HTTP agent to repoint.
 */

import chalk from "chalk";
import prompts from "prompts";
import {
  type AgentResponse,
  type AgentsApiService,
} from "@/client-sdk/services/agents/agents-api.service";
import {
  commandValidationError,
  reportCommandError,
} from "../../../utils/errorOutput";
import { loadConfig, saveConfig } from "../../../utils/governance/config";

export function fail(message: string): never {
  reportCommandError({ error: commandValidationError(message) });
  process.exit(1);
}

/** The local URL the flags point at, after mutual-exclusion validation. */
export function resolveLocalUrl(options: {
  port?: string;
  url?: string;
}): string {
  if (options.port && options.url) {
    fail("--port and --url are mutually exclusive. Pass one of them.");
  }
  if (options.port) {
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      fail(`--port must be a number between 1 and 65535, got "${options.port}"`);
    }
    return `http://localhost:${port}`;
  }
  if (options.url) {
    let parsed: URL;
    try {
      parsed = new URL(options.url);
    } catch {
      fail(`--url must be a valid URL, got "${options.url}"`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      fail("--url must be an http or https URL");
    }
    return options.url;
  }
  fail(
    "Pass the local server to expose: --port <number> for http://localhost:<number>, or --url <local url>.",
  );
}

/** Remember the chosen agent for this directory in ~/.langwatch/config.json. */
export function rememberAgentForDirectory(agentId: string): void {
  try {
    const cfg = loadConfig();
    cfg.agent_dev_agents = {
      ...(cfg.agent_dev_agents ?? {}),
      [process.cwd()]: agentId,
    };
    saveConfig(cfg);
  } catch {
    // Best-effort convenience; a config write failure must not block the run.
  }
}

function rememberedAgentForDirectory(): string | undefined {
  try {
    return loadConfig().agent_dev_agents?.[process.cwd()];
  } catch {
    return undefined;
  }
}

/**
 * Resolve which registered HTTP agent this session repoints:
 *
 *   1. `--agent <id|name>`: an exact id, else a name match over HTTP agents.
 *   2. The agent remembered for this directory from a previous run.
 *   3. An interactive picker over the project's HTTP agents (TTY only).
 */
export async function resolveTargetAgent({
  service,
  agentFlag,
}: {
  service: AgentsApiService;
  agentFlag?: string;
}): Promise<AgentResponse> {
  const listing = await service.list({ limit: 100 });
  const httpAgents = listing.data.filter((agent) => agent.type === "http");

  if (agentFlag) {
    return agentFromFlag({ agentFlag, all: listing.data, httpAgents });
  }

  const remembered = agentFromMemory(httpAgents);
  if (remembered) return remembered;

  return pickHttpAgent(httpAgents);
}

/** `--agent <id|name>`: an exact id, else a name match over HTTP agents. */
function agentFromFlag({
  agentFlag,
  all,
  httpAgents,
}: {
  agentFlag: string;
  all: AgentResponse[];
  httpAgents: AgentResponse[];
}): AgentResponse {
  const byId = all.find((agent) => agent.id === agentFlag);
  const byName = httpAgents.filter(
    (agent) => agent.name.toLowerCase() === agentFlag.toLowerCase(),
  );
  const match = byId ?? byName[0];
  if (!match) {
    fail(
      `No agent matches "${agentFlag}". Run \`langwatch agent list\` to see the registered agents.`,
    );
  }
  if (match.type !== "http") {
    fail(
      `Agent "${match.name}" has type "${match.type}". Only HTTP agents can point at a local tunnel.`,
    );
  }
  if (!byId && byName.length > 1) {
    fail(
      `More than one HTTP agent is named "${agentFlag}". Pass the agent id instead: langwatch agent dev --agent <id>`,
    );
  }
  return match;
}

/**
 * The agent remembered for this directory from a previous run. Undefined when
 * nothing is remembered, or when the remembered agent is gone from the
 * project, in which case selection falls through to the picker.
 */
function agentFromMemory(httpAgents: AgentResponse[]): AgentResponse | undefined {
  const remembered = rememberedAgentForDirectory();
  if (!remembered) return undefined;

  const match = httpAgents.find((agent) => agent.id === remembered);
  if (!match) return undefined;

  console.log(
    chalk.gray(
      `Using agent "${match.name}" remembered for this directory (override with --agent).`,
    ),
  );
  return match;
}

/** The only HTTP agent, else an interactive picker over them (TTY only). */
async function pickHttpAgent(
  httpAgents: AgentResponse[],
): Promise<AgentResponse> {
  if (httpAgents.length === 0) {
    fail(
      "This project has no HTTP agents. Create one first: langwatch agent create \"My Agent\" --type http --config '{\"url\":\"https://...\"}'",
    );
  }
  if (httpAgents.length === 1) {
    return httpAgents[0]!;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(
      "More than one HTTP agent is registered. Pass which one to use: langwatch agent dev --agent <id|name>",
    );
  }

  const answer = await prompts({
    type: "select",
    name: "agentId",
    message: "Which agent should point at your machine?",
    choices: httpAgents.map((agent) => ({
      title: agent.name,
      description:
        typeof agent.config?.url === "string" ? agent.config.url : undefined,
      value: agent.id,
    })),
    initial: 0,
  });
  const chosen = httpAgents.find((agent) => agent.id === answer.agentId);
  if (!chosen) {
    fail("No agent selected.");
  }
  return chosen;
}
