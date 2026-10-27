import { createLogger } from "@langwatch/observability";
import { fromDate } from "@langwatch/time";
import {
  dslStoringHttpSecrets,
  type WorkflowDsl,
  type WorkflowVersion,
} from "@langwatch/workflow-contract";

import type { WorkflowHttpSecrets } from "../app/workflow.app.ts";
import type { WorkflowRepository } from "../repositories/workflow.repository.ts";

const logger = createLogger("langwatch:workflow:http-credentials-backfill");

/** What one pass did; the ledger keeps it. Ids and counts only, never a credential. */
export type WorkflowHttpCredentialsBackfillReport = {
  afterProjectId: string | null;
  projects: number;
  moved: number;
  held: number;
};

/**
 * Stores credentials typed inline into the HTTP nodes of workflows' latest and published versions
 * as project secrets (modules/workflow/specs/http-credentials.feature). Level-triggered: a version
 * counts as moved only when a re-read holds no literal; anything else is held and fails the pass.
 */
export class WorkflowHttpCredentialsBackfillService {
  static create(deps: {
    workflows: Pick<
      WorkflowRepository,
      | "findProjectIds"
      | "findAll"
      | "findById"
      | "findPublishedVersion"
      | "updateVersionDslIfUnchanged"
    >;
    httpSecrets: WorkflowHttpSecrets;
  }): WorkflowHttpCredentialsBackfillService {
    return new WorkflowHttpCredentialsBackfillService(deps);
  }

  private constructor(
    private readonly deps: Parameters<typeof WorkflowHttpCredentialsBackfillService.create>[0],
  ) {}

  async moveLiterals({
    dryRun,
    signal,
    afterProjectId,
    onProjectDone,
  }: {
    dryRun: boolean;
    signal: AbortSignal;
    afterProjectId: string | null;
    onProjectDone: (report: WorkflowHttpCredentialsBackfillReport) => Promise<void>;
  }): Promise<WorkflowHttpCredentialsBackfillReport> {
    const report: WorkflowHttpCredentialsBackfillReport = {
      afterProjectId,
      projects: 0,
      moved: 0,
      held: 0,
    };
    const projectIds = (await this.deps.workflows.findProjectIds()).toSorted();
    for (const projectId of projectIds) {
      if (signal.aborted) break;
      if (afterProjectId !== null && projectId <= afterProjectId) continue;
      report.projects += 1;
      await this.moveProject({ projectId, dryRun, report });
      // The cursor stops before the first project with held work, so a retry revisits it.
      if (report.held === 0) report.afterProjectId = projectId;
      if (!dryRun) await onProjectDone({ ...report });
    }
    if (report.held > 0) {
      throw new Error(
        `${report.held} workflow version(s) still hold HTTP credentials that could not be stored as project secrets; ` +
          "the worker log names each version. Retry the step once the cause is fixed.",
      );
    }

    return report;
  }

  private async moveProject({
    projectId,
    dryRun,
    report,
  }: {
    projectId: string;
    dryRun: boolean;
    report: WorkflowHttpCredentialsBackfillReport;
  }): Promise<void> {
    for (const { id: workflowId } of await this.deps.workflows.findAll({ projectId })) {
      const literal = await this.versionsHoldingLiterals({ projectId, workflowId });
      if (literal.length === 0) continue;
      if (dryRun) {
        report.moved += literal.length;
        continue;
      }
      for (const version of literal) await this.moveVersion({ projectId, version });
      const held = await this.versionsHoldingLiterals({ projectId, workflowId });
      const heldIds = new Set(held.map(({ id }) => id));
      report.moved += literal.filter(({ id }) => !heldIds.has(id)).length;
      report.held += held.length;
      for (const { id: versionId } of held) {
        logger.warn({ projectId, workflowId, versionId }, "version credentials held for a retry");
      }
    }
  }

  private async versionsHoldingLiterals({
    projectId,
    workflowId,
  }: {
    projectId: string;
    workflowId: string;
  }): Promise<WorkflowVersion[]> {
    const workflow = await this.deps.workflows.findById({
      id: workflowId,
      projectId,
      includeVersion: true,
    });
    const published = await this.deps.workflows.findPublishedVersion({ workflowId, projectId });
    const versions = new Map<string, WorkflowVersion>();
    for (const version of [workflow?.latestVersion, workflow?.currentVersion, published]) {
      if (version) versions.set(version.id, version);
    }
    const found: WorkflowVersion[] = [];
    for (const version of versions.values()) {
      if (await holdsLiteral(version.dsl)) found.push(version);
    }

    return found;
  }

  /** Written only if nobody saved the version since it was read; the re-read decides. */
  private async moveVersion(input: { projectId: string; version: WorkflowVersion }): Promise<void> {
    const { projectId, version } = input;
    const nodes = Array.isArray(version.dsl.nodes) ? version.dsl.nodes : [];
    const moved: unknown[] = [];
    for (const node of nodes) {
      moved.push(await this.nodeOf({ projectId, versionId: version.id, node }));
    }
    if (JSON.stringify(moved) === JSON.stringify(nodes)) return;

    const dsl: WorkflowDsl = { ...version.dsl, nodes: moved };
    await this.deps.workflows.updateVersionDslIfUnchanged({
      id: version.id,
      projectId,
      dsl,
      updatedAt: fromDate(version.updatedAt),
    });
  }

  /** One node at a time, so a full project (the secret cap) holds that node and no other. */
  private async nodeOf(input: {
    projectId: string;
    versionId: string;
    node: unknown;
  }): Promise<unknown> {
    try {
      const { nodes } = await this.deps.httpSecrets.store({
        projectId: input.projectId,
        dsl: { nodes: [input.node] },
        authorId: undefined,
      });
      return Array.isArray(nodes) ? nodes[0] : input.node;
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, versionId: input.versionId, reason: reasonOf(error) },
        "node credentials not moved",
      );
      return input.node;
    }
  }
}

/** Whether a graph's HTTP nodes hold a credential that is not a `{{ secrets.NAME }}` reference. */
async function holdsLiteral(dsl: WorkflowDsl): Promise<boolean> {
  let found = false;
  await dslStoringHttpSecrets({
    dsl,
    reference: async ({ value }) => {
      found = true;
      return value;
    },
  });

  return found;
}

/** The error's kind only: a message may echo the value being stored. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
