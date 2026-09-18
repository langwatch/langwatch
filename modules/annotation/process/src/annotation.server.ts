import { defineServerModule } from "@langwatch/kernel";
import { AnnotationApp } from "#app/annotation.app";
import { annotationRepositories } from "#repositories/annotation-repositories.registry";
import { annotationRest } from "#transport/annotation.rest";
import { annotationTrpcTransport } from "#transport/annotation.trpc";
import { annotationScoreTrpcTransport } from "#transport/annotation-score.trpc";

/**
 * The whole module, declared. Every call answers something already
 * installable, so there is no build step to forget and no half-declared
 * module. What it needs is read off `AnnotationApp.create` and the registry.
 */
export const annotationServer = defineServerModule("annotation")
  .withRepositories(annotationRepositories)
  .withApp(AnnotationApp)
  .withTransports(annotationRest, annotationTrpcTransport, annotationScoreTrpcTransport);
