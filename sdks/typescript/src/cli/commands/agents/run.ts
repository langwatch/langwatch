import { scopedApiKey } from "@/internal/credentialContext";
import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  AgentsApiService,
  type AgentCallBody,
  type AgentCallMessage,
  type AgentParameterSpec,
} from "@/client-sdk/services/agents/agents-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { buildAuthHeaders } from "@/internal/api/auth";
import { parseRunParameterFlags } from "../../utils/keyValueFlags";
import type { CommandResult } from "../../utils/output";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";

export interface RunAgentOptions {
  input?: string;
  message?: string;
  param?: string[];
  threadId?: string;
}

const isMessageList = (value: unknown): value is AgentCallMessage[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as AgentCallMessage).role === "string",
  );

/**
 * The relay body for a connected agent: `--message` is one user turn,
 * `--input` is the body itself (it must carry `messages`), `--param` gives
 * the run parameters and `--thread-id` continues a conversation. A `--param`
 * value is read as the type the agent declares for it.
 */
export function buildRelayBody({
  input,
  options,
  parameters = [],
}: {
  input: Record<string, unknown>;
  options: RunAgentOptions;
  /** The parameters the agent declares, for the type each value is read as. */
  parameters?: readonly AgentParameterSpec[];
}): AgentCallBody | string {
  const params = parseRunParameterFlags({
    pairs: options.param,
    types: new Map(parameters.map((spec) => [spec.name, spec.type])),
  });
  const fromInput = input.messages;
  let messages: AgentCallMessage[];
  if (options.message !== undefined) {
    messages = [{ role: "user", content: options.message }];
  } else if (isMessageList(fromInput)) {
    messages = fromInput;
  } else {
    return "a connected agent takes a conversation: give --message <text>, or --input with a messages list.";
  }
  const body: AgentCallBody = { messages };
  const threadId =
    options.threadId ?? (typeof input.threadId === "string" ? input.threadId : undefined);
  if (threadId) body.threadId = threadId;
  if (isMessageList(input.newMessages)) body.newMessages = input.newMessages;
  if (input.session !== undefined) body.session = input.session;
  const inputParams =
    typeof input.params === "object" && input.params !== null
      ? (input.params as Record<string, string | number | boolean>)
      : undefined;
  if (inputParams || params) body.params = { ...(inputParams ?? {}), ...(params ?? {}) };
  return body;
}

/**
 * Returns the run's response rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts). Three paths
 * return their own result: the relay for a connected agent, the URL for an
 * HTTP agent, the workflow engine for a workflow-linked one.
 *
 * @see specs/typescript-sdk/cli-agents.feature
 */
export const runAgentCommand = async (
  id: string,
  options: RunAgentOptions,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new AgentsApiService();

  // First get the agent to determine its type
  const resolveSpinner = createSpinner(`Fetching agent "${id}"...`).start();

  let agent;
  try {
    agent = await service.get(id);
    resolveSpinner.succeed(`Found agent "${agent.name}" (type: ${agent.type})`);
  } catch (error) {
    failSpinner({
      spinner: resolveSpinner,
      error,
      action: `fetch agent "${id}"`,
    });
    process.exit(1);
  }

  let input: Record<string, unknown> = {};
  if (options.input) {
    try {
      input = JSON.parse(options.input) as Record<string, unknown>;
    } catch {
      console.error(chalk.red("Error: --input must be valid JSON"));
      process.exit(1);
    }
  }

  const config = agent.config;

  if (agent.type === "connected") {
    const body = buildRelayBody({ input, options, parameters: agent.parameters });
    if (typeof body === "string") {
      console.error(chalk.red(`Error: ${body}`));
      process.exit(1);
    }
    if (agent.status === "offline") {
      console.error(
        chalk.yellow(
          `Agent "${agent.name}" is offline. Start the process that calls connectAgent and try again.`,
        ),
      );
      process.exit(1);
    }

    const runSpinner = createSpinner(`Calling connected agent "${agent.name}"...`).start();
    try {
      const result = await service.call(agent.id, body);
      const where = result.instance?.label
        ? `${result.instance.hostname} (${result.instance.label})`
        : (result.instance?.hostname ?? "an instance");
      runSpinner.succeed(`Agent "${agent.name}" answered from ${where} in ${result.durationMs} ms`);

      return {
        data: result,
        table: () => {
          console.log();
          console.log(chalk.bold("  Output:"));
          const output =
            typeof result.output === "string"
              ? result.output
              : JSON.stringify(result.output, null, 2);
          console.log(`    ${output.split("\n").join("\n    ")}`);
          if (result.session !== undefined && result.session !== null) {
            console.log();
            console.log(chalk.bold("  Session:"));
            console.log(
              `    ${JSON.stringify(result.session, null, 2).split("\n").join("\n    ")}`,
            );
          }
          console.log();
        },
      };
    } catch (error) {
      failSpinner({ spinner: runSpinner, error, action: `call agent "${agent.name}"` });
      process.exit(1);
    }
  }

  if (agent.type === "http") {
    // HTTP agent: call the URL directly
    const url = config?.url as string | undefined;
    if (!url) {
      console.error(chalk.red("Error: HTTP agent has no URL configured"));
      process.exit(1);
    }

    const runSpinner = createSpinner(`Calling HTTP agent at ${url}...`).start();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      const result = (await response.json()) as Record<string, unknown>;
      runSpinner.succeed(`HTTP agent responded (${response.status})`);

      return {
        data: result,
        table: () => {
          console.log();
          console.log(chalk.bold("  Response:"));
          console.log(`    ${JSON.stringify(result, null, 2).split("\n").join("\n    ")}`);
          console.log();
        },
      };
    } catch (error) {
      failSpinner({ spinner: runSpinner, error, action: "call HTTP agent" });
      process.exit(1);
    }
  } else {
    // For signature/code/workflow agents, try to run via the workflow API
    const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = resolveControlPlaneUrl();

    // Check if agent has a linked workflow
    const workflowId = config?.workflowId as string | undefined;
    if (!workflowId) {
      console.error(
        chalk.yellow(
          `Agent "${agent.name}" (type: ${agent.type}) cannot be executed directly from CLI.\n` +
            `Only connected agents, HTTP agents and workflow-linked agents can be run.\n` +
            `To test this agent, use it within a workflow in the UI.`,
        ),
      );
      process.exit(1);
    }

    const runSpinner = createSpinner(`Running agent via workflow ${workflowId}...`).start();
    try {
      const response = await fetch(
        `${endpoint}/api/workflows/${encodeURIComponent(workflowId)}/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildAuthHeaders({ apiKey }),
          },
          body: JSON.stringify(input),
        },
      );

      if (!response.ok) {
        const message = await formatFetchError(response);
        failSpinner({ spinner: runSpinner, error: new Error(message), action: "run agent" });
        process.exit(1);
      }

      const result = (await response.json()) as Record<string, unknown>;
      runSpinner.succeed(`Agent "${agent.name}" executed successfully`);

      return {
        data: result,
        table: () => {
          console.log();
          if (result.output !== undefined) {
            console.log(chalk.bold("  Output:"));
            const output =
              typeof result.output === "string"
                ? result.output
                : JSON.stringify(result.output, null, 2);
            console.log(`    ${output.split("\n").join("\n    ")}`);
          } else {
            console.log(chalk.bold("  Result:"));
            console.log(`    ${JSON.stringify(result, null, 2).split("\n").join("\n    ")}`);
          }
          console.log();
        },
      };
    } catch (error) {
      failSpinner({
        spinner: runSpinner,
        error,
        action: `run agent "${agent.name}"`,
      });
      process.exit(1);
    }
  }
};
