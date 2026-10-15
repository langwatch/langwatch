import {
  DEFAULT_INSIGHT_RUN_MAX_INSIGHTS,
  type InsightApi,
  requestInsightDailyRunInputSchema,
} from "@langwatch/insight-contract";
import { Task } from "@langwatch/task";

const USAGE =
  "insight-daily-run-request <projectId> <userId> <dashboard|template> <boardId> [boardName] [maxInsights]";

/**
 * Asks for one daily insights run now, for one person on one board: the operator's way to run
 * it before any schedule exists, and to run it again after an incident. The worker carries the
 * run out as that person and records how it ended.
 */
export class InsightDailyRunRequestTask extends Task {
  readonly name = "insight-daily-run-request";
  readonly description = "Requests one daily insights run for a project, a person and a board.";

  private constructor(private readonly insights: Pick<InsightApi, "requestDailyRun">) {
    super();
  }

  static create({
    insights,
  }: {
    insights: Pick<InsightApi, "requestDailyRun">;
  }): InsightDailyRunRequestTask {
    return new InsightDailyRunRequestTask(insights);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const [projectId, userId, kind, id, name, maxInsights] = args;
    const input = requestInsightDailyRunInputSchema.safeParse({
      projectId,
      userId,
      // The name is only what the run's row shows until the run reads the board itself.
      board: { kind, id, name: name ?? id },
      maxInsights:
        maxInsights === undefined ? DEFAULT_INSIGHT_RUN_MAX_INSIGHTS : Number(maxInsights),
    });
    if (!input.success) throw new Error(`Usage: ${USAGE}`);
    await this.insights.requestDailyRun(input.data);
  }
}
