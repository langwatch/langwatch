import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { TopicApi } from "@langwatch/topic-contract";
import { defineMigrationStep, type MigrationStepCheckpoint } from "@langwatch/upgrade/step";

import { TopicModule } from "./app/topic.app.ts";
import { topicClusteringEventing } from "./eventing/topic-clustering-processing.pipeline.ts";
import { topicRepositories } from "./repositories/topic-repositories.registry.ts";
import { TopicClusteringRunTask } from "./tasks/topic-clustering-run.task.ts";
import { topicTrpcTransport } from "./transport/topic.trpc.ts";

export const topicProcessModule: PublishedProcessModule<"topic", TopicApi> = defineProcessModule(
  "topic",
)
  .withRepositories(topicRepositories)
  .withApi(TopicModule)
  .withTransports(topicTrpcTransport)
  .withEventing(topicClusteringEventing)
  .withTasks(({ app }) => [TopicClusteringRunTask.create({ topics: app })])
  .withMigrations(({ app }) => [
    defineMigrationStep({
      id: "topic:seed-topic-model-history",
      kind: "data",
      mode: "background",
      description:
        "Records each project's existing topics on the topic stream so clustering owns them.",
      needsOldWritersGone: true,
      run: ({ checkpoint, dryRun, signal }) =>
        app.seedTopicModelHistoryStep({ ...resumeOf(checkpoint), dryRun, signal }),
    }),
    defineMigrationStep({
      id: "topic:seed-clustering-schedules",
      kind: "data",
      mode: "background",
      description: "Schedules daily topic clustering for every eligible project that has none yet.",
      needsOldWritersGone: true,
      run: ({ checkpoint, dryRun, signal }) =>
        app.seedClusteringSchedulesStep({ ...resumeOf(checkpoint), dryRun, signal }),
    }),
  ]);

/** Resumes after the last project a saved page reached, and saves each clean page. */
function resumeOf(checkpoint: MigrationStepCheckpoint) {
  const afterId = checkpoint.resumeFrom?.["afterId"];
  return {
    afterId: typeof afterId === "string" ? afterId : null,
    onPage: (report: Record<string, unknown>) => checkpoint.save({ report }),
  };
}
