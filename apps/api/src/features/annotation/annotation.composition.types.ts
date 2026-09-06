/**
 * ComposedAnnotationFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
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
