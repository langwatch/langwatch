import type { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { entryInlineWithDefaults } from "~/optimization_studio/server/entryInputDefaults";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import type {
  Entry,
  Field,
  Workflow as WorkflowDSL,
} from "~/optimization_studio/types/dsl";
import type { StudioClientEvent } from "~/optimization_studio/types/events";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:workflows:evaluation");

export type WorkflowEvaluationParameters = Record<
  string,
  string | number | boolean
>;

export class WorkflowNotFoundError extends Error {
  constructor(workflowId: string) {
    super(`Workflow ${workflowId} not found`);
  }
}

export class NoCommittedVersionError extends Error {
  constructor() {
    super(
      "This workflow has no committed version to evaluate. Commit a version (or run Evaluate once in the studio) first.",
    );
  }
}

/**
 * Triggers studio workflow evaluations outside the studio session -
 * the REST surface CI pipelines call. Builds the same
 * `execute_evaluation` event the Evaluate button posts, over a
 * committed version's DSL, and lets the run report back through the
 * regular evaluation pipeline (experiment + batch results).
 */
export class WorkflowEvaluationService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): WorkflowEvaluationService {
    return new WorkflowEvaluationService(prisma);
  }

  async triggerEvaluation({
    projectId,
    workflowId,
    versionId,
    evaluateOn = "full",
    parameters = {},
  }: {
    projectId: string;
    workflowId: string;
    versionId?: string;
    evaluateOn?: "full" | "test" | "train";
    parameters?: WorkflowEvaluationParameters;
  }): Promise<{ runId: string; workflowVersionId: string; version: string }> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: workflowId, projectId, archivedAt: null },
    });
    if (!workflow) {
      throw new WorkflowNotFoundError(workflowId);
    }

    const version = versionId
      ? await this.prisma.workflowVersion.findFirst({
          where: { id: versionId, workflowId, projectId },
        })
      : // Latest manual commit wins; fall back to the latest autosave so
        // a workflow that was only ever autosaved is still evaluable.
        ((await this.prisma.workflowVersion.findFirst({
          where: { workflowId, projectId, autoSaved: false },
          orderBy: { createdAt: "desc" },
        })) ??
        (await this.prisma.workflowVersion.findFirst({
          where: { workflowId, projectId },
          orderBy: { createdAt: "desc" },
        })));
    if (!version) {
      throw new NoCommittedVersionError();
    }

    const dsl = version.dsl as unknown as WorkflowDSL;
    const runId = `run_${nanoid()}`;

    let event: StudioClientEvent = {
      type: "execute_evaluation",
      payload: {
        run_id: runId,
        workflow: dsl,
        workflow_version_id: version.id,
        evaluate_on: evaluateOn,
        origin: "api",
      },
    };

    // Same server-side preparation the studio path applies: provider
    // envs + dataset materialization (db dataset → inline records).
    event = await loadDatasets(await addEnvs(event, projectId), projectId);

    if (
      Object.keys(parameters).length > 0 &&
      event.type === "execute_evaluation"
    ) {
      injectEntryParameters(event.payload.workflow as WorkflowDSL, parameters);
    }

    // Fire and forget: the evaluation reports its own lifecycle through
    // the evaluation pipeline (experiment record + batch results); the
    // API caller polls the experiment, it doesn't hold this connection.
    void studioBackendPostEvent({
      projectId,
      message: event,
      onEvent: (serverEvent) => {
        if (serverEvent.type === "error") {
          logger.error(
            { runId, workflowId, projectId, serverEvent },
            "api-triggered evaluation reported an error",
          );
        }
      },
    }).catch((error: unknown) => {
      logger.error(
        { error, runId, workflowId, projectId },
        "api-triggered evaluation failed to start",
      );
    });

    return { runId, workflowVersionId: version.id, version: version.version };
  }
}

/**
 * Binds caller-provided parameters as constant entry inputs: each key
 * becomes an entry field (if not already one) and a constant column on
 * the materialized dataset, so every evaluated row carries the value.
 * With no dataset attached, the parameters themselves form a single
 * synthetic row - evaluate-with-flags needs no placeholder dataset.
 */
export function injectEntryParameters(
  workflow: WorkflowDSL,
  parameters: WorkflowEvaluationParameters,
): void {
  const entryNode = workflow.nodes.find((n) => n.type === "entry");
  if (!entryNode) return;
  const entry = entryNode.data as Entry;

  const outputs: Field[] = [...(entry.outputs ?? [])];
  for (const key of Object.keys(parameters)) {
    if (!outputs.some((o) => o.identifier === key)) {
      outputs.push({ identifier: key, type: "str" });
    }
  }
  entry.outputs = outputs;

  const inline = entry.dataset?.inline;
  if (inline) {
    const rowCount = Math.max(
      1,
      ...Object.values(inline.records).map((column) => column.length),
    );
    for (const [key, value] of Object.entries(parameters)) {
      inline.records[key] = Array<unknown>(rowCount).fill(value);
      if (!inline.columnTypes.some((c) => c.name === key)) {
        inline.columnTypes.push({ name: key, type: "string" });
      }
    }
  } else {
    entry.dataset = {
      name: "API parameters",
      inline: {
        records: Object.fromEntries(
          Object.entries(parameters).map(([key, value]) => [key, [value]]),
        ),
        columnTypes: Object.keys(parameters).map((key) => ({
          name: key,
          type: "string" as const,
        })),
      },
    };
  }

  // Backfill any entry field with a default value that the caller did not
  // provide as a parameter, so the run gets the default instead of nothing.
  if (entry.dataset?.inline) {
    entry.dataset = {
      ...entry.dataset,
      inline: entryInlineWithDefaults(
        entry.dataset.inline,
        entry.outputs ?? [],
      ),
    };
  }
}
