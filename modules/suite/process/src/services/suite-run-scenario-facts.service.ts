import { createLogger } from "@langwatch/observability";
import type {
  SimulationRunEvaluatedEventData,
  SimulationRunFinishedEventData,
  SimulationRunStartedEventData,
} from "@langwatch/scenario-contract";
import { isSuiteSetId } from "@langwatch/suite-contract";

import type { SuiteRunItemCommandsService } from "./suite-run-item-commands.service.ts";

const logger = createLogger("langwatch:suite:scenario-run-facts");

/** Where a scenario fact landed: its tenant, its instant and its id. */
export interface ScenarioRunFactContext {
  tenantId: string;
  occurredAt: number;
  eventId: string;
}

type SuiteRunItemSenders = Pick<
  SuiteRunItemCommandsService,
  "recordSuiteRunItemStarted" | "completeSuiteRunItem" | "regradeSuiteRunItem"
>;

/**
 * Suite progress follows scenario's run facts: a run of a suite set starting,
 * finishing or changing its verdict moves its suite run's item. Runs of any
 * other set are left alone; every send is idempotent on its item.
 */
export class SuiteRunScenarioFactsService {
  static create(runItems: SuiteRunItemSenders): SuiteRunScenarioFactsService {
    return new SuiteRunScenarioFactsService(runItems);
  }

  private constructor(private readonly runItems: SuiteRunItemSenders) {}

  /** Whether a fact names a suite set, so a run of any other set mints no job. */
  static belongsToSuite(data: { scenarioSetId?: string | undefined }): boolean {
    return data.scenarioSetId !== undefined && isSuiteSetId(data.scenarioSetId);
  }

  async recordStarted(
    data: SimulationRunStartedEventData,
    context: ScenarioRunFactContext,
  ): Promise<void> {
    if (!SuiteRunScenarioFactsService.belongsToSuite(data)) return;
    await this.runItems.recordSuiteRunItemStarted({
      tenantId: context.tenantId,
      batchRunId: data.batchRunId,
      scenarioRunId: data.scenarioRunId,
      scenarioId: data.scenarioId,
      occurredAt: context.occurredAt,
    });
  }

  async recordFinished(
    data: SimulationRunFinishedEventData,
    context: ScenarioRunFactContext,
  ): Promise<void> {
    if (!SuiteRunScenarioFactsService.belongsToSuite(data)) return;
    // A finish recorded before the run's identity travelled on it cannot name its item.
    if (!data.batchRunId || !data.scenarioId || !data.status) {
      logger.debug(
        { tenantId: context.tenantId, scenarioRunId: data.scenarioRunId },
        "Skipped a finished scenario run that carries no suite item identity",
      );
      return;
    }
    await this.runItems.completeSuiteRunItem({
      tenantId: context.tenantId,
      batchRunId: data.batchRunId,
      scenarioRunId: data.scenarioRunId,
      scenarioId: data.scenarioId,
      status: data.status,
      verdict: data.results?.verdict,
      durationMs: data.durationMs,
      reasoning: data.results?.reasoning,
      error: data.results?.error,
      occurredAt: context.occurredAt,
    });
  }

  /** Only a verdict or status that moved changes the counts; the fact's id keys the change. */
  async recordEvaluated(
    data: SimulationRunEvaluatedEventData,
    context: ScenarioRunFactContext,
  ): Promise<void> {
    if (!SuiteRunScenarioFactsService.belongsToSuite(data)) return;
    if (!data.batchRunId || !data.scenarioId || !data.status || !data.previousStatus) {
      logger.debug(
        { tenantId: context.tenantId, scenarioRunId: data.scenarioRunId },
        "Skipped an evaluated scenario run that carries no suite item identity",
      );
      return;
    }
    if (data.status === data.previousStatus && data.verdict === data.previousVerdict) return;
    await this.runItems.regradeSuiteRunItem({
      tenantId: context.tenantId,
      batchRunId: data.batchRunId,
      scenarioRunId: data.scenarioRunId,
      scenarioId: data.scenarioId,
      previousStatus: data.previousStatus,
      previousVerdict: data.previousVerdict,
      status: data.status,
      verdict: data.verdict,
      idempotencyKey: context.eventId,
      occurredAt: context.occurredAt,
    });
  }
}
