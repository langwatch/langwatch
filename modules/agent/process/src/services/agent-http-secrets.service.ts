import {
  createSecretReferencer,
  httpAgentConfigStoringSecrets,
  httpAgentConfigSchema,
  type CreateAgentCommand,
  type UpdateAgentCommand,
} from "@langwatch/agent-contract";
import type { SecretApi } from "@langwatch/secret-contract";

import { nextAgentId } from "../rules/agent-id.rules.ts";
import type { AgentService } from "./agent.service.ts";

type AgentHttpSecretsOptions = {
  secrets: Pick<SecretApi, "list" | "getValuesByName" | "create">;
  agents: Pick<AgentService, "getById">;
};

/** Stores the token typed into an HTTP agent as a project secret named from the agent's id,
 * leaving its reference. */
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
      reference: createSecretReferencer({
        values: async () => {
          const names = (await this.options.secrets.list({ projectId })).map(({ name }) => name);

          return this.options.secrets.getValuesByName({ projectId, names });
        },
        create: async ({ name, value }) => {
          await this.options.secrets.create({ projectId, name, value });
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
