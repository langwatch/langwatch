import type { AnnotationApi } from "@langwatch/annotation-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { AnnotationModule } from "#app/annotation.app";
import { annotationLifecycleEventing } from "#eventing/annotation-lifecycle.pipeline";
import { annotationRepositories } from "#repositories/annotation-repositories.registry";
import { AnnotationTraceBackfillTask } from "#tasks/annotation-trace-backfill.task";
import { annotationScoreTrpcTransport } from "#transport/annotation-score.trpc";
import { annotationRest } from "#transport/annotation.rest";
import { annotationTrpcTransport } from "#transport/annotation.trpc";

/**
 * The whole module, declared. Every call answers something already
 * installable, so there is no build step to forget and no half-declared
 * module. What it needs is read off `AnnotationModule.create` and the registry.
 */
export const annotationProcessModule: PublishedProcessModule<"annotation", AnnotationApi> =
  defineProcessModule("annotation")
    .withRepositories(annotationRepositories)
    .withApi(AnnotationModule)
    .withTransports(annotationRest, annotationTrpcTransport, annotationScoreTrpcTransport)
    .withEventing(annotationLifecycleEventing)
    .withTasks(({ app, dependencies }) => [
      AnnotationTraceBackfillTask.create({
        annotations: app,
        traces: dependencies.traces,
        projects: dependencies.projects,
        organizations: dependencies.organizations,
      }),
    ])
    .withMigrations(({ app }) => [
      defineMigrationStep({
        id: "annotation:record-existing-facts",
        kind: "data",
        mode: "background",
        description:
          "Records every existing annotation and score definition as annotation's fact, for trace to read.",
        // An old image still writing annotations records no facts: wait until none serves.
        needsOldWritersGone: true,
        run: async ({ checkpoint, dryRun, signal }) => {
          const resumed = checkpoint.resumeFrom?.afterProjectId;
          return app.recordExistingFacts({
            dryRun,
            signal,
            afterProjectId: typeof resumed === "string" ? resumed : null,
            onProjectDone: ({ projectId, report }) =>
              checkpoint.save({ report: { afterProjectId: projectId, ...report } }),
          });
        },
      }),
    ]);
