/** Binds the feature's declared procedures to this process's execution path. */
import type { AnnotationApi } from "@langwatch/annotation-contract";
import {
  annotationScoreTrpcTransport,
  annotationTrpcTransport,
} from "@langwatch/annotation-server";
import type { TrpcRuntime } from "@langwatch/api/trpc";

/** The one slice of the process context these two namespaces read. */
export interface AnnotationHostContext {
  app: Readonly<{ annotation: AnnotationApi }>;
}

export function createAnnotationTrpcRouter<TContext extends AnnotationHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(annotationTrpcTransport, (ctx) => ctx.app.annotation);
}

export function createAnnotationScoreTrpcRouter<TContext extends AnnotationHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(annotationScoreTrpcTransport, (ctx) => ctx.app.annotation);
}
