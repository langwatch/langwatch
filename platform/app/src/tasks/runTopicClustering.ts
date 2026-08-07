import { getApp } from "~/server/app-layer/app";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import type { ClusteringPageOutcome } from "~/server/app-layer/topic-clustering/clustering";

export default async function execute(projectId: string) {
  // The App owns the ClickHouse resolver clustering reads through, so the task
  // boots it and takes the clustering page from there rather than wiring its
  // own.
  initializeDefaultApp();
  const { runPage } = getApp().topicClustering;

  // One stable run identity for the whole walk, so re-recorded pages dedupe
  // instead of appending a fresh topics_recorded chain on every re-run.
  const runId = `manual-task-${Date.now()}`;
  let page = 1;
  let searchAfter: ClusteringPageOutcome["nextSearchAfter"];
  do {
    const outcome = await runPage({
      projectId,
      searchAfter,
      runContext: { runId, page },
    });
    console.log(
      `mode=${outcome.mode} traces=${outcome.tracesProcessed}` +
        (outcome.skippedReason ? ` skipped=${outcome.skippedReason}` : ""),
    );
    searchAfter = outcome.nextSearchAfter;
    page++;
  } while (searchAfter);
}
