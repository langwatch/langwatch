import type { AnnotationApi } from "@langwatch/annotation-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { AnnotationModule } from "#app/annotation.app";
import { annotationLifecycleEventing } from "#eventing/annotation-lifecycle.pipeline";
import { annotationRepositories } from "#repositories/annotation-repositories.registry";
import { AnnotationTraceBackfillService } from "#services/annotation-trace-backfill.service";
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
    // Old images record annotations on traces their own way: run once none serves (ADR-173 §3).
    .withMigrations(({ app, dependencies }) => [
      defineMigrationStep({
        id: "annotation:record-trace-annotations",
        kind: "data",
        mode: "background",
        needsOldWritersGone: true,
        description:
          "Records every existing annotation on its trace, so has-annotation search agrees with them.",
        run: async ({ checkpoint, dryRun, signal }) => {
          const resumed = checkpoint.resumeFrom?.afterOrganizationId;
          const report = await AnnotationTraceBackfillService.create({
            peers: {
              annotations: app,
              traces: dependencies.traces,
              projects: dependencies.projects,
              organizations: dependencies.organizations,
            },
          }).backfill({
            after: typeof resumed === "string" ? resumed : undefined,
            dryRun,
            signal,
            onPage: (page) => checkpoint.save({ report: page }),
          });
          return { ...report, dryRun };
        },
      }),
    ])
    .withTasks(({ app, dependencies }) => [
      AnnotationTraceBackfillTask.create({
        annotations: app,
        traces: dependencies.traces,
        projects: dependencies.projects,
        organizations: dependencies.organizations,
      }),
    ]);
