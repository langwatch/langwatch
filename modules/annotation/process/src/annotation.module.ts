import { defineProcessModule } from "@langwatch/process";

import { AnnotationModule } from "#app/annotation.app";
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
export const annotationProcessModule = defineProcessModule("annotation")
  .withRepositories(annotationRepositories)
  .withApi(AnnotationModule)
  .withTransports(annotationRest, annotationTrpcTransport, annotationScoreTrpcTransport)
  .withTasks(({ app, dependencies }) => [
    AnnotationTraceBackfillTask.create({
      annotations: app,
      traces: dependencies.traces,
      projects: dependencies.projects,
      organizations: dependencies.organizations,
    }),
  ]);
