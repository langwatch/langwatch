import { defineModule } from "@langwatch/runtime-composition";
import { AnnotationApp } from "#app/annotation.app";
import { annotationRepositories } from "#repositories/annotation-repositories.registry";
import { annotationRest } from "#transport/annotation.rest";
import { annotationTrpcTransport } from "#transport/annotation.trpc";
import { annotationScoreTrpcTransport } from "#transport/annotation-score.trpc";

export const annotationServer = defineModule("annotation")
  .withRepositories(annotationRepositories)
  .withApp(AnnotationApp)
  .withTransports(annotationRest, annotationTrpcTransport, annotationScoreTrpcTransport)
  .build();
