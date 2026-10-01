import {
  createSecretReferencer,
  httpAgentConfigStoringSecrets,
  httpAgentConfigSchema,
  type CreateAgentCommand,
  type UpdateAgentCommand,
} from "@langwatch/agent-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { findOrigins } from "@langwatch/workflow-contract";

import { nextAgentId } from "../rules/agent-id.rules.ts";
import type { AgentService } from "./agent.service.ts";

type AgentHttpSecretsOptions = {
  secrets: Pick<SecretApi, "getValues" | "list" | "create">;
  agents: Pick<AgentService, "getById">;
};

/** Stores the token typed into an HTTP agent as a project secret named from the agent's id and
 * bound to the agent's origin, leaving its reference. */
export class AgentHttpSecretsService {
  static create(options: AgentHttpSecretsOptions): AgentHttpSecretsService {
    return new AgentHttpSecretsService(options);
  }

  private constructor(private readonly options: AgentHttpSecretsOptions) {}

  forCreate(command: CreateAgentCommand): Promise<CreateAgentCommand> {
    if (command.type !== "http") return Promise.resolve(command);
    const id = command.id ?? nextAgentId();

    return this.stored({ command: { ...command, id }, owner: id });
  }

  async forUpdate(command: UpdateAgentCommand): Promise<UpdateAgentCommand> {
    if (!command.config) return command;
    const existing = await this.options.agents.getById({
      id: command.id,
      projectId: command.projectId,
    });

    return (command.type ?? existing.type) === "http"
      ? this.stored({ command, owner: command.id })
      : command;
  }

  private async stored<Command extends { projectId: string; config?: unknown }>(input: {
    command: Command;
    owner: string;
  }): Promise<Command> {
    const { command, owner } = input;
    const parsed = httpAgentConfigSchema.safeParse(command.config);
    if (!parsed.success) return command;

    const { projectId } = command;
    const { headers, auth } = await httpAgentConfigStoringSecrets({
      config: parsed.data,
      owner,
      origin: findOrigins(parsed.data.url)[0],
      reference: createSecretReferencer({
        values: () => this.options.secrets.getValues({ projectId }),
        origins: async () => {
          const origins: Record<string, string> = {};
          for (const { name, boundOrigin } of await this.options.secrets.list({ projectId })) {
            if (boundOrigin) origins[name] = boundOrigin;
          }

          return origins;
        },
        create: async ({ name, value, boundOrigin }) => {
          await this.options.secrets.create({ projectId, name, value, boundOrigin });
        },
      }),
    });

    return {
      ...command,
      config: {
        ...parsed.data,
        ...(headers ? { headers } : {}),
        ...(auth ? { auth } : {}),
      },
    };
  }
}
