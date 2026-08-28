/**
 * App-process transport mounts for the annotation vertical.
 *
 * Behaviour is package-owned (`@langwatch/annotation-server`); these supply the
 * process's tRPC root, its authenticated procedure, its policy chain, and — for
 * the annotation surface — the application ports the annotation package does
 * not own: the annotation-queue rows, the trace reads that resolve an item's
 * content for a reviewer, the trace-correction overlay a suggested output is
 * carried into, and the trace-side record of "a human commented on this".
 */
import {
  AnnotationScoreTrpcApi,
  AnnotationTrpcApi,
  type AnnotationScoreTrpcContext,
  type AnnotationTrpcContext,
  type AnnotationTrpcPorts,
} from "@langwatch/annotation-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { appTrpcPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type AnnotationMount<
  TContext extends AnnotationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TPorts extends AnnotationTrpcPorts,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  /**
   * Forwarded untouched. Their concrete return types are what the client sees,
   * so this mount is generic over them rather than widening them to the port's
   * declared minimum.
   */
  ports: TPorts;
}>;

type AnnotationScoreMount<
  TContext extends AnnotationScoreTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
}>;

/** Mounts `annotation.*` on the app process's tRPC root. */
export function createAnnotationTrpcRouter<
  TContext extends AnnotationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TPorts extends AnnotationTrpcPorts,
>(mount: AnnotationMount<TContext, TOptions, TRoot, TPorts>) {
  return AnnotationTrpcApi.create(
    mount.root,
    { protected: mount.protectedProcedure, policy: appTrpcPolicy(mount.middlewares) },
    mount.ports,
  );
}

/** Mounts `annotationScore.*` on the app process's tRPC root. */
export function createAnnotationScoreTrpcRouter<
  TContext extends AnnotationScoreTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: AnnotationScoreMount<TContext, TOptions, TRoot>) {
  return AnnotationScoreTrpcApi.create(mount.root, {
    protected: mount.protectedProcedure,
    policy: appTrpcPolicy(mount.middlewares),
  });
}
