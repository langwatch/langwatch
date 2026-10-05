import { httpAgentConfigStoringSecrets, type HttpAgentConfig } from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import type { AgentHttpSecretsService } from "../services/agent-http-secrets.service.ts";
import type { AgentService } from "../services/agent.service.ts";

const logger = createLogger("langwatch:tasks:backfill-http-agent-credentials-to-secrets");

type BackfillServices = Readonly<{
  agents: Pick<AgentService, "listProjectIdsWithHttpAgents" | "getAll" | "update">;
  httpSecrets: Pick<AgentHttpSecretsService, "forUpdate">;
}>;

/** Moves the tokens typed inline into HTTP agents before they became project secrets. */
export class AgentHttpCredentialsBackfillTask extends Task {
  readonly name = "backfill-http-agent-credentials-to-secrets";
  readonly description =
    "Stores literal HTTP agent credentials as project secrets. Idempotent; safe to run before or after backfill-http-credentials-to-secrets.";

  private constructor(private readonly services: BackfillServices) {
    super();
  }

  static create(services: BackfillServices): AgentHttpCredentialsBackfillTask {
    return new AgentHttpCredentialsBackfillTask(services);
  }

  async run({ signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    for (const projectId of await this.services.agents.listProjectIdsWithHttpAgents()) {
      signal.throwIfAborted();
      await this.agentsOf(projectId);
    }
    logger.info("Finished moving inline HTTP agent credentials into project secrets");
  }

  private async agentsOf(projectId: string): Promise<void> {
    for (const agent of await this.services.agents.getAll({ projectId })) {
      if (agent.type !== "http" || !(await holdsLiteral(agent.config))) continue;
      try {
        const command = { id: agent.id, projectId, config: agent.config };
        await this.services.agents.update(await this.services.httpSecrets.forUpdate(command));
        logger.info({ projectId, agentId: agent.id }, "agent credentials moved to secrets");
      } catch (error) {
        logger.error({ error, projectId, agentId: agent.id }, "agent credentials left in place");
      }
    }
  }
}

/** Whether the config holds a credential that is not a `{{ secrets.NAME }}` reference. */
async function holdsLiteral(config: HttpAgentConfig): Promise<boolean> {
  let found = false;
  await httpAgentConfigStoringSecrets({
    config,
    owner: "probe",
    reference: async ({ value }) => {
      found = true;
      return value;
    },
  });

  return found;
}
