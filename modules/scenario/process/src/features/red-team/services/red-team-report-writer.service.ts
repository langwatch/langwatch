import type { Logger } from "@langwatch/observability";
import type {
  ScenarioExecutionResult,
  ScenarioExecutionService,
} from "@langwatch/scenario-contract";

const RED_TEAM_REPORT_WRITE_ATTEMPTS = 3;
const RED_TEAM_REPORT_RETRY_DELAY_MS = 200;

/** Every write of a broke outcome failed: the run must not finish as passed. */
export class RedTeamBreakNotRecordedError extends Error {
  constructor(scenarioRunId: string) {
    super(`Could not record the red team break for scenarioRunId=${scenarioRunId}`);
    this.name = "RedTeamBreakNotRecordedError";
  }
}

export type RedTeamReportRecord =
  | { outcome: "recorded" }
  | { outcome: "break_not_recorded"; error: RedTeamBreakNotRecordedError };

/** Writes a finished red team run's report, retrying, and keeps a break on record. */
export class RedTeamReportWriterService {
  static create(
    execution: Pick<ScenarioExecutionService, "recordRedTeamReport">,
  ): RedTeamReportWriterService {
    return new RedTeamReportWriterService(execution);
  }

  private constructor(
    private readonly execution: Pick<ScenarioExecutionService, "recordRedTeamReport">,
  ) {}

  /**
   * The report is the only record of a break. When the full report cannot be written, a broke
   * outcome is written again without its turn scores, so the run still folds to FAILED. When that
   * fails too, the error is returned: the job fails and the run finishes unsuccessful.
   */
  async record(input: {
    projectId: string;
    scenarioRunId: string;
    report: NonNullable<ScenarioExecutionResult["redTeam"]>;
    jobLogger: Logger;
  }): Promise<RedTeamReportRecord> {
    const { jobLogger, report, ...run } = input;
    const full = await this.write({ ...run, report });
    if (full.isWritten) return { outcome: "recorded" };
    jobLogger.error(
      {
        err: full.error,
        scenarioRunId: run.scenarioRunId,
        attempts: RED_TEAM_REPORT_WRITE_ATTEMPTS,
      },
      "Could not record the red team run's report",
    );
    if (report.outcome !== "broke") return { outcome: "recorded" };
    const outcomeOnly = await this.write({
      ...run,
      report: { ...report, turnScores: [] },
    });
    if (outcomeOnly.isWritten) {
      jobLogger.warn(
        { scenarioRunId: run.scenarioRunId },
        "Recorded the red team break without its turn scores",
      );
      return { outcome: "recorded" };
    }
    jobLogger.error(
      { err: outcomeOnly.error, scenarioRunId: run.scenarioRunId },
      "Could not record the red team break: failing the job",
    );
    return {
      outcome: "break_not_recorded",
      error: new RedTeamBreakNotRecordedError(run.scenarioRunId),
    };
  }

  private async write(input: {
    projectId: string;
    scenarioRunId: string;
    report: NonNullable<ScenarioExecutionResult["redTeam"]>;
  }): Promise<{ isWritten: true } | { isWritten: false; error: unknown }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= RED_TEAM_REPORT_WRITE_ATTEMPTS; attempt++) {
      try {
        await this.execution.recordRedTeamReport(input);
        return { isWritten: true };
      } catch (error) {
        lastError = error;
        if (attempt < RED_TEAM_REPORT_WRITE_ATTEMPTS) {
          await new Promise((resolve) =>
            setTimeout(resolve, RED_TEAM_REPORT_RETRY_DELAY_MS * attempt),
          );
        }
      }
    }
    return { isWritten: false, error: lastError };
  }
}
