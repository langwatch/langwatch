import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import type {
  TopicClusteringPageOutcome,
  TopicClusteringRunPort,
} from "../intents/topic-clustering.intent";

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
 * The composed entrypoint is still absent: a real {@link TopicClusteringRunPort}
 * needs a model-provider gateway, langevals, a Prisma repository, AND two
 * separate producer-only Eventing registrations (`topic_clustering_processing`
 * and the trace pipeline), neither with a ready-made producer factory the way
 * `simulation_processing` has. Full collaborator list and blocker:
 * `apps/tasks/src/tasks.catalogue.ts` and the launch-interface plan doc.
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
