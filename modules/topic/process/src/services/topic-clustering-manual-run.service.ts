import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type {
  TopicClusteringPageOutcome,
  TopicClusteringRun,
} from "../eventing/topic-clustering.intent.ts";

const logger = createLogger("langwatch:tasks:topic-clustering-run");

/** Walks every clustering page for one project, outside its cadence gate. */
export class TopicClusteringManualRunService {
  private constructor(private readonly runner: TopicClusteringRun) {}

  static create({ runner }: { runner: TopicClusteringRun }): TopicClusteringManualRunService {
    return new TopicClusteringManualRunService(runner);
  }

  async run({ projectId }: { projectId: string }): Promise<void> {
    // One stable run identity for the whole walk, so re-recorded pages dedupe
    // instead of appending a fresh topics_recorded chain on every re-run.
    const runId = `manual-task-${nowInstant().epochMilliseconds}`;
    let page = 1;
    let searchAfter: TopicClusteringPageOutcome["nextSearchAfter"];
    do {
      const outcome = await this.runner.runClusteringPage({
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
