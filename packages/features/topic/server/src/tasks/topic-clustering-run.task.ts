import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import type { TopicClusteringPageOutcome, TopicClusteringRunPort } from "../intents/topic-clustering.intent";

const logger = createLogger("langwatch:tasks:topic-clustering-run");

/**
 * Manual, one-shot clustering run for a single project — the operator's
 * escape hatch for a project that needs a run outside its own cadence gate,
 * or a re-run after a langevals/model incident.
 *
 * Walks every page `runPage` returns until `nextSearchAfter` is empty. One
 * stable run identity for the whole walk, so re-recorded pages dedupe instead
 * of appending a fresh `topics_recorded` chain on every re-run.
 *
 * The composed entrypoint is still absent, and the reason is named: the
 * runner needs `TopicClusteringCommandsPort` and `TraceTopicAssignmentPort`,
 * both dispatched through the Topic and Trace processing pipelines'
 * PRODUCER-side commands — the same Eventing-over-Group-Queue infrastructure
 * `stalled-runs-backfill` is blocked on — and `apps/tasks` composes no
 * Eventing producer today. `runPage` takes the composed
 * {@link TopicClusteringRunPort} as a parameter, so a runner is a few lines
 * the moment that pipeline is reachable from this process.
 */
export class TopicClusteringRunTask extends Task {
  readonly name = "topic-clustering-run";
  readonly description = "Runs a manual topic-clustering walk for one project.";

  private constructor(private readonly runPage: () => TopicClusteringRunPort) {
    super();
  }

  static create({ runPage }: { runPage: () => TopicClusteringRunPort }): TopicClusteringRunTask {
    return new TopicClusteringRunTask(runPage);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const projectId = args[0];
    if (!projectId) {
      throw new Error("topic-clustering-run requires a projectId as its first argument");
    }

    const runner = this.runPage();

    // One stable run identity for the whole walk, so re-recorded pages dedupe
    // instead of appending a fresh topics_recorded chain on every re-run.
    const runId = `manual-task-${Date.now()}`;
    let page = 1;
    let searchAfter: TopicClusteringPageOutcome["nextSearchAfter"];
    do {
      const outcome = await runner.runClusteringPage({
        projectId,
        searchAfter: searchAfter ?? null,
        runId,
        page,
      });
      logger.info(
        {
          mode: outcome.mode,
          tracesProcessed: outcome.tracesProcessed,
          skippedReason: outcome.skippedReason,
        },
        "topic-clustering-run page finished",
      );
      searchAfter = outcome.nextSearchAfter;
      page++;
    } while (searchAfter);
  }
}
