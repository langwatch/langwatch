import type { EvaluatorApi, EvaluatorWithFields } from "@langwatch/evaluator-contract";
import type { EvaluatorAttachment, RunScenarioEvaluationsDeps } from "@langwatch/scenario-contract";

import type { ScenarioService } from "./scenario.service.ts";

/**
 * What grading reads for a run no suite pinned evaluators on: the scenario's own test suite's
 * attachments and the saved evaluators they name. A suite pins its plan's on the run it queues.
 */
export class ScenarioRunAttachmentsService implements Readonly<
  RunScenarioEvaluationsDeps["suites"]
> {
  static create(options: {
    scenarios: Pick<ScenarioService, "listTestSuites">;
    evaluators: Pick<EvaluatorApi, "findByIdWithFields">;
  }): ScenarioRunAttachmentsService {
    return new ScenarioRunAttachmentsService(options);
  }

  private constructor(
    private readonly options: {
      scenarios: Pick<ScenarioService, "listTestSuites">;
      evaluators: Pick<EvaluatorApi, "findByIdWithFields">;
    },
  ) {}

  /** The test suite's attachments, each evaluator once; an archived suite still answers. */
  getRunAttachments = async ({
    projectId,
    suiteId,
  }: {
    projectId: string;
    suiteId?: string | null;
    planId?: string | null;
  }): Promise<EvaluatorAttachment[]> => {
    if (!suiteId) return [];
    const testSuites = await this.options.scenarios.listTestSuites({
      projectId,
      includeArchived: true,
    });
    const attachments = testSuites.find((candidate) => candidate.id === suiteId)?.evaluators ?? [];
    const seen = new Set<string>();
    return attachments.filter((attachment) => {
      if (seen.has(attachment.evaluatorId)) return false;
      seen.add(attachment.evaluatorId);
      return true;
    });
  };

  /** The saved evaluators the attachments name, with their fields, by id; unknown ids left out. */
  getAttachedEvaluators = async ({
    projectId,
    attachments,
  }: {
    projectId: string;
    attachments: readonly Pick<EvaluatorAttachment, "evaluatorId">[];
  }): Promise<Map<string, EvaluatorWithFields>> => {
    const ids = [...new Set(attachments.map((attachment) => attachment.evaluatorId))];
    const rows = await Promise.all(
      ids.map((id) => this.options.evaluators.findByIdWithFields({ id, projectId })),
    );
    return new Map(rows.flatMap((row) => (row ? [[row.id, row] as const] : [])));
  };
}
