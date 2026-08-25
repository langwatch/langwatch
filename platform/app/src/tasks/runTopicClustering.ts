import { initializeDefaultApp } from "~/server/app-layer/presets";
import {
  clusterTopicsForProject,
  type ClusteringPageOutcome,
} from "~/server/app-layer/topic-clustering/clustering";

export default async function execute(projectId: string) {
  // The App owns the ClickHouse resolver; the task calls the clustering
  // algorithm directly because it is not an App service surface.
  const app = initializeDefaultApp();

  // One stable run identity for the whole walk, so re-recorded pages dedupe
  // instead of appending a fresh topics_recorded chain on every re-run.
  const runId = `manual-task-${Date.now()}`;
  let page = 1;
  let searchAfter: ClusteringPageOutcome["nextSearchAfter"];
  do {
    const outcome = await clusterTopicsForProject({
      projectId,
      searchAfter,
      runContext: { runId, page },
      resolveClickHouseClient: app.clickhouse.resolveClient,
    });
    console.log(
      `mode=${outcome.mode} traces=${outcome.tracesProcessed}` +
        (outcome.skippedReason ? ` skipped=${outcome.skippedReason}` : ""),
    );
    searchAfter = outcome.nextSearchAfter;
    page++;
  } while (searchAfter);
}
