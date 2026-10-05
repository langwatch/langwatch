import { findUnkeyedFilterFields } from "@langwatch/analytics-filters";
import {
  TriggerFilterKeyRequiredError,
  TriggerFilterMonitorRequiredError,
} from "@langwatch/automation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";

import { findEvaluationFilterReferences } from "../rules/trigger-filter-shape.rules.ts";

/**
 * The write-time check on an automation's structured conditions: refuse the
 * shapes that save fine and then match nothing. Stored rows are never
 * re-checked; only a save that states conditions is held to this.
 */
export class TriggerFilterValidationService {
  private constructor(
    private readonly evaluators: Pick<EvaluatorApi, "findById">,
    private readonly monitors: Pick<MonitorApi, "findByEvaluator">,
  ) {}

  static create({
    evaluators,
    monitors,
  }: {
    evaluators: Pick<EvaluatorApi, "findById">;
    monitors: Pick<MonitorApi, "findByEvaluator">;
  }): TriggerFilterValidationService {
    return new TriggerFilterValidationService(evaluators, monitors);
  }

  /**
   * An evaluator's id is refused, naming the monitors that run it (none is
   * still a refusal: results are keyed by monitor). Any other id is let
   * through: an SDK-reported evaluation keys results by an id no table knows.
   */
  async assertWritable({
    projectId,
    filters,
  }: {
    projectId: string;
    filters: Record<string, unknown>;
  }): Promise<void> {
    const [unkeyed] = findUnkeyedFilterFields(filters);
    if (unkeyed) throw new TriggerFilterKeyRequiredError(unkeyed);

    const references = findEvaluationFilterReferences(filters);
    for (const evaluatorId of new Set(references.map((reference) => reference.id))) {
      const evaluator = await this.evaluators.findById({ id: evaluatorId, projectId });
      if (!evaluator) continue;
      const monitors = await this.monitors.findByEvaluator({ projectId, evaluatorId });
      const reference = references.find(({ id }) => id === evaluatorId);
      throw new TriggerFilterMonitorRequiredError({
        field: reference?.field ?? "evaluations",
        evaluatorId,
        monitorIds: monitors.map((monitor) => monitor.id),
      });
    }
  }
}
