import type { EvaluatorAttachment } from "@langwatch/scenario-contract";
import {
  findMissingMappings,
  mergeRunAttachments,
  SuiteEvaluatorMappingsMissingError,
} from "@langwatch/suite-contract";

import type { SuiteServiceOptions } from "./suite.service.ts";

/** A suite run's evaluator mapping check, raised before any plan row is written or job queued. */
export class SuiteRunMappingService {
  static create(options: SuiteServiceOptions): SuiteRunMappingService {
    return new SuiteRunMappingService(options);
  }

  private constructor(private readonly options: SuiteServiceOptions) {}

  /**
   * Refuses a run while an attachment in its scope misses a required mapping, before any plan
   * row is written or any job queued, as main's `assertRunMappings` did. A scenario filed in a
   * suite runs the suite's copy of a duplicated evaluator; an unfiled one runs the plan's list.
   */
  async assertRunMappings({
    projectId,
    scenarioIds,
    planId,
    planAttachments,
  }: {
    projectId: string;
    scenarioIds: string[];
    planId: string | undefined;
    planAttachments: readonly EvaluatorAttachment[];
  }): Promise<void> {
    const { scenarios, evaluators } = this.options;
    const wanted = new Set(scenarioIds);
    const filed = (await scenarios.list({ projectId })).filter((scenario) =>
      wanted.has(scenario.id),
    );
    const suiteIds = new Set(filed.flatMap((row) => (row.testSuiteId ? [row.testSuiteId] : [])));
    if (suiteIds.size === 0 && planAttachments.length === 0) return;

    const suites = (await scenarios.listTestSuites({ projectId, includeArchived: true })).filter(
      (suite) => suiteIds.has(suite.id),
    );
    const hasUnfiledScenario = suiteIds.size === 0 || filed.some((row) => !row.testSuiteId);
    const scoped = [
      ...suites.map((suite) => ({
        suiteId: suite.id,
        attachments: mergeRunAttachments({ suiteAttachments: suite.evaluators, planAttachments }),
      })),
      ...(hasUnfiledScenario && planAttachments.length > 0
        ? [{ suiteId: planId ?? "", attachments: [...planAttachments] }]
        : []),
    ];
    const evaluatorIds = [
      ...new Set(
        scoped.flatMap((entry) => entry.attachments.map((attachment) => attachment.evaluatorId)),
      ),
    ];
    if (evaluatorIds.length === 0) return;

    const saved = await Promise.all(
      evaluatorIds.map((id) => evaluators.findByIdWithFields({ id, projectId })),
    );
    const evaluatorsById = new Map(
      saved
        .flatMap((evaluator) => (evaluator ? [evaluator] : []))
        .map((evaluator) => [evaluator.id, evaluator]),
    );
    for (const entry of scoped) {
      const [missing] = findMissingMappings({ attachments: entry.attachments, evaluatorsById });
      if (missing) {
        throw new SuiteEvaluatorMappingsMissingError({
          evaluatorId: missing.attachment.evaluatorId,
          suiteId: entry.suiteId,
          inputs: missing.inputs.map((input) => input.id),
        });
      }
    }
  }
}
