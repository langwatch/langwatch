import {
  httpAgentConfigStoringSecrets,
  type AgentApi,
  type HttpAgentConfig,
} from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { Task } from "@langwatch/task";
import type { WorkflowDsl, WorkflowVersion } from "@langwatch/workflow-contract";

import type { WorkflowHttpSecrets } from "../app/workflow.app.ts";
import type { WorkflowRepository } from "../repositories/workflow.repository.ts";

const logger = createLogger("langwatch:tasks:backfill-http-credentials-to-secrets");

type BackfillPeers = Readonly<{
  organizations: Pick<OrganizationApi, "findAllIds">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
  agents: Pick<AgentApi, "getAll" | "update">;
  workflows: Pick<
    WorkflowRepository,
    "findAll" | "findById" | "findPublishedVersion" | "updateVersionDslIfUnchanged"
  >;
  httpSecrets: WorkflowHttpSecrets;
}>;

/** Moves the tokens typed inline before they became project secrets; once and idempotently. */
export class WorkflowHttpCredentialsBackfillTask extends Task {
  readonly name = "backfill-http-credentials-to-secrets";
  readonly description =
    "Stores literal HTTP credentials of agents and of workflows' latest and published versions as project secrets.";

  private constructor(private readonly peers: BackfillPeers) {
    super();
  }

  static create(peers: BackfillPeers): WorkflowHttpCredentialsBackfillTask {
    return new WorkflowHttpCredentialsBackfillTask(peers);
  }

  async run({ signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    for (const organizationId of await this.peers.organizations.findAllIds()) {
      const projectIds = await this.peers.projects.listIdsByOrganization({ organizationId });
      for (const projectId of projectIds) {
        signal.throwIfAborted();
        await this.agentsOf(projectId);
        await this.workflowsOf(projectId);
      }
    }
    logger.info("Finished moving inline HTTP credentials into project secrets");
  }

  private async agentsOf(projectId: string): Promise<void> {
    for (const agent of await this.peers.agents.getAll({ projectId })) {
      if (agent.type !== "http" || !(await holdsLiteral(agent.config))) continue;
      try {
        await this.peers.agents.update({ id: agent.id, projectId, config: agent.config });
        logger.info({ projectId, agentId: agent.id }, "agent credentials moved to secrets");
      } catch (error) {
        logger.error({ error, projectId, agentId: agent.id }, "agent credentials left in place");
      }
    }
  }

  private async workflowsOf(projectId: string): Promise<void> {
    for (const { id: workflowId } of await this.peers.workflows.findAll({ projectId })) {
      const workflow = await this.peers.workflows.findById({
        id: workflowId,
        projectId,
        includeVersion: true,
      });
      const published = await this.peers.workflows.findPublishedVersion({ workflowId, projectId });
      const versions = new Map<string, WorkflowVersion>();
      for (const version of [workflow?.latestVersion, workflow?.currentVersion, published]) {
        if (version) versions.set(version.id, version);
      }
      for (const version of versions.values()) {
        await this.versionOf({ projectId, version });
      }
    }
  }

  private async versionOf(input: {
    projectId: string;
    version: WorkflowVersion;
  }): Promise<void> {
    const { projectId, version } = input;
    const nodes = Array.isArray(version.dsl.nodes) ? version.dsl.nodes : [];
    const moved: unknown[] = [];
    for (const node of nodes) {
      moved.push(await this.nodeOf({ projectId, versionId: version.id, node }));
    }
    if (JSON.stringify(moved) === JSON.stringify(nodes)) return;

    const dsl: WorkflowDsl = { ...version.dsl, nodes: moved };
    // Written only if nobody saved the version since it was read; a later run picks it up.
    const written = await this.peers.workflows.updateVersionDslIfUnchanged({
      id: version.id,
      projectId,
      dsl,
      updatedAt: version.updatedAt,
    });
    if (written) {
      logger.info({ projectId, versionId: version.id }, "version credentials moved to secrets");
    } else {
      logger.warn({ projectId, versionId: version.id }, "version changed since read, skipped");
    }
  }

  /** One node at a time, so a full project (the secret cap) skips that node and no other. */
  private async nodeOf(input: {
    projectId: string;
    versionId: string;
    node: unknown;
  }): Promise<unknown> {
    try {
      const { nodes } = await this.peers.httpSecrets.store({
        projectId: input.projectId,
        dsl: { nodes: [input.node] },
        authorId: undefined,
      });
      return Array.isArray(nodes) ? nodes[0] : input.node;
    } catch (error) {
      logger.error(
        { error, projectId: input.projectId, versionId: input.versionId, nodeId: nodeIdOf(input.node) },
        "node credentials left in place",
      );
      return input.node;
    }
  }
}

function nodeIdOf(node: unknown): string | undefined {
  return typeof node === "object" && node !== null && "id" in node && typeof node.id === "string"
    ? node.id
    : undefined;
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
