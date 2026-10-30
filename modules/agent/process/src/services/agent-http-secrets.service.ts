import {
  type Agent,
  createSecretReferencer,
  httpAgentConfigStoringSecrets,
  httpAgentConfigSchema,
  AgentHooksUrlTemplatedOriginError,
  AgentStoredCredentialsDestinationError,
  templatesHooksOrigin,
  type CreateAgentCommand,
  type UpdateAgentCommand,
} from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";
import type { SecretApi } from "@langwatch/secret-contract";

import { nextAgentId } from "../rules/agent-id.rules.ts";
import {
  movesStoredSecrets,
  replacedSigningSecretNames,
  withoutHooklessSigningSecret,
} from "../rules/agent-secrets.rules.ts";
import type { AgentService } from "./agent.service.ts";

const logger = createLogger("langwatch:agents:http-secrets");

type AgentHttpSecretsOptions = {
  secrets: Pick<SecretApi, "list" | "getValuesByName" | "create" | "delete">;
  agents: Pick<AgentService, "getById" | "getAll">;
};

/** A hooks URL's scheme and host are fixed at save; the most specific refusal comes first. */
function refuseTemplatedHooksOrigin(config: unknown): void {
  const parsed = httpAgentConfigSchema.safeParse(config);
  if (parsed.success && templatesHooksOrigin(parsed.data.hooksUrl)) {
    throw new AgentHooksUrlTemplatedOriginError();
  }
}

/** Stores the token typed into an HTTP agent as a project secret named from the agent's id,
 * leaving its reference. */
export class AgentHttpSecretsService {
  static create(options: AgentHttpSecretsOptions): AgentHttpSecretsService {
    return new AgentHttpSecretsService(options);
  }

  private constructor(private readonly options: AgentHttpSecretsOptions) {}

  async forCreate(command: CreateAgentCommand): Promise<CreateAgentCommand> {
    if (command.type !== "http") return command;
    refuseTemplatedHooksOrigin(command.config);
    const id = command.id ?? nextAgentId();

    return this.stored({ command: { ...command, id }, owner: id });
  }

  async forUpdate(command: UpdateAgentCommand): Promise<UpdateAgentCommand> {
    if (!command.config) return command;
    const existing = await this.options.agents.getById({
      id: command.id,
      projectId: command.projectId,
    });

    if ((command.type ?? existing.type) !== "http") return command;
    // Refuse before any secret is created, so a refused save leaves nothing behind.
    refuseTemplatedHooksOrigin(command.config);
    const incoming = httpAgentConfigSchema.safeParse(command.config);
    if (
      incoming.success &&
      existing.type === "http" &&
      movesStoredSecrets({ stored: existing.config, incoming: incoming.data })
    ) {
      throw new AgentStoredCredentialsDestinationError();
    }

    return this.stored({ command, owner: command.id });
  }

  /**
   * Deletes the hooks signing secret a save replaced (a rotation, or hooks removed). Runs after the
   * save landed, so a failed save never loses the secret it still names; a failed delete is
   * logged and the save stands.
   */
  async dropReplacedSigningSecret(input: { before: Agent; after: Agent }): Promise<void> {
    const { before, after } = input;
    const { projectId } = after;
    try {
      const names = replacedSigningSecretNames({
        agentId: after.id,
        before,
        after,
        projectAgents: await this.options.agents.getAll({ projectId }),
      });
      if (names.length === 0) return;
      const rows = await this.options.secrets.list({ projectId });
      for (const row of rows.filter(({ name }) => names.includes(name))) {
        await this.options.secrets.delete({ projectId, id: row.id });
      }
    } catch (error) {
      logger.warn(
        { err: error, projectId, agentId: after.id },
        "could not delete the replaced hooks signing secret",
      );
    }
  }

  private async stored<Command extends { projectId: string; config?: unknown }>(input: {
    command: Command;
    owner: string;
  }): Promise<Command> {
    const { command, owner } = input;
    const parsed = httpAgentConfigSchema.safeParse(command.config);
    if (!parsed.success) return command;

    const { projectId } = command;
    // No project secret is made for a signing secret an agent without hooks would never use.
    const config = withoutHooklessSigningSecret(parsed.data);
    const { headers, auth, hooksSigningSecret } = await httpAgentConfigStoringSecrets({
      config,
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
        ...config,
        ...(headers ? { headers } : {}),
        ...(auth ? { auth } : {}),
        ...(hooksSigningSecret ? { hooksSigningSecret } : {}),
      },
    };
  }
}
