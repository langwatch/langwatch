/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type {
  createAnnotationScoreTrpcRouter,
  createAnnotationTrpcRouter,
} from "./annotation-trpc.mount.ts";

/** The two namespaces and the `ctx.app.annotation` slice. */
export type ComposedAnnotationFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    annotation: ReturnType<typeof createAnnotationTrpcRouter<ApiTrpcContext>>;
    annotationScore: ReturnType<typeof createAnnotationScoreTrpcRouter<ApiTrpcContext>>;
  };
  /** For `ctx.app.annotation`, which the annotation REST family also reads. */
  app: AnnotationApi;
  /**
   * The lazy service entry the process's one REST list takes for this feature.
   * A provider rather than the application itself, so building the list never
   * forces construction — the OpenAPI generator builds it with none.
   */
  restServices: Readonly<{ annotations: () => AnnotationApi }>;
}>;
