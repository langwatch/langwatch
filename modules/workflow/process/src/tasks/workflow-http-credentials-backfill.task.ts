import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import { fromDate } from "@langwatch/time";
import type { WorkflowDsl, WorkflowVersion } from "@langwatch/workflow-contract";

import type { WorkflowHttpSecrets } from "../app/workflow.app.ts";
import type { WorkflowRepository } from "../repositories/workflow.repository.ts";

const logger = createLogger("langwatch:tasks:backfill-http-credentials-to-secrets");

type BackfillPeers = Readonly<{
  workflows: Pick<
    WorkflowRepository,
    | "findProjectIds"
    | "findAll"
    | "findById"
    | "findPublishedVersion"
    | "updateVersionDslIfUnchanged"
  >;
  httpSecrets: WorkflowHttpSecrets;
}>;

/**
 * Moves the tokens typed inline into workflow versions before they became project secrets;
 * once and idempotently. HTTP agents are agent's own `backfill-http-agent-credentials-to-secrets`.
 */
export class WorkflowHttpCredentialsBackfillTask extends Task {
  readonly name = "backfill-http-credentials-to-secrets";
  readonly description =
    "Stores literal HTTP credentials of workflows' latest and published versions as project secrets. Idempotent; safe to run before or after backfill-http-agent-credentials-to-secrets.";

  private constructor(private readonly peers: BackfillPeers) {
    super();
  }

  static create(peers: BackfillPeers): WorkflowHttpCredentialsBackfillTask {
    return new WorkflowHttpCredentialsBackfillTask(peers);
  }

  async run({ signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    for (const projectId of await this.peers.workflows.findProjectIds()) {
      signal.throwIfAborted();
      await this.workflowsOf(projectId);
    }
    logger.info("Finished moving inline workflow HTTP credentials into project secrets");
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

  private async versionOf(input: { projectId: string; version: WorkflowVersion }): Promise<void> {
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
      updatedAt: fromDate(version.updatedAt),
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
        {
          error,
          projectId: input.projectId,
          versionId: input.versionId,
          ...nodeIdFields(input.node),
        },
        "node credentials left in place",
      );
      return input.node;
    }
  }
}

function nodeIdFields(node: unknown): { nodeId?: string } {
  return typeof node === "object" && node !== null && "id" in node && typeof node.id === "string"
    ? { nodeId: node.id }
    : {};
}
