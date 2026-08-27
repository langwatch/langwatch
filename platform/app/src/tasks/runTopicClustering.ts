import {
  type ClusteringPageOutcome,
  clusterTopicsForProject,
  LegacyImportTopicClusteringMigration,
  PostgresTopicAdapter,
} from "@langwatch/topic-server";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { createAppTopicClusteringRunnerDeps } from "~/runtime/app/features/topic";

export default async function execute(projectId: string) {
  // The App owns the ClickHouse resolver and the model-provider cascade; the
  // task calls the clustering runner directly because it is not an App
  // service surface.
  const app = initializeDefaultApp();

  const persistence = PostgresTopicAdapter.createClusteringPersistence({
    database: prisma,
  });
  const deps = createAppTopicClusteringRunnerDeps({
    resolveClickHouseClient: app.clickhouse.resolveClient,
    modelProviders: app.modelProviders,
    managedProviders: app.managedProviders,
    repository: persistence.repository,
    migration: LegacyImportTopicClusteringMigration.create({
      repository: persistence.repository,
      redis: null,
      commands: {
        recordTopics: (args) => app.topicClustering.recordTopics(args),
        requestClustering: (args) => app.topicClustering.requestClustering(args),
      },
    }),
    commands: {
      recordTopics: (args) => app.topicClustering.recordTopics(args),
      requestClustering: (args) => app.topicClustering.requestClustering(args),
      assignTopic: (args) => app.traces.assignTopic(args),
    },
  });

  // One stable run identity for the whole walk, so re-recorded pages dedupe
  // instead of appending a fresh topics_recorded chain on every re-run.
  const runId = `manual-task-${Date.now()}`;
  let page = 1;
  let searchAfter: ClusteringPageOutcome["nextSearchAfter"];
  do {
    const outcome = await clusterTopicsForProject(deps, {
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
