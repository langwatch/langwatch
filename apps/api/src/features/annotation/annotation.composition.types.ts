/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { AnnotationApp } from "@langwatch/annotation-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type {
  createAnnotationScoreTrpcRouter,
  createAnnotationTrpcRouter,
} from "./annotation-trpc.mount";

/** The two namespaces and the `ctx.app.annotations` slice. */
export type ComposedAnnotationFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    annotation: ReturnType<typeof createAnnotationTrpcRouter>;
    annotationScore: ReturnType<typeof createAnnotationScoreTrpcRouter>;
  };
  /** For `ctx.app.annotations`, which the annotation REST family also reads. */
  app: AnnotationApp;
}>;
