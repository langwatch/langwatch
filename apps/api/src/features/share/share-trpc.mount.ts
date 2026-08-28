/**
 * App-process transport mounts for the share vertical.
 *
 * Behaviour is package-owned (`@langwatch/share-server`); this supplies the
 * process's root, authenticated procedure and policy chain.
 *
 * Every procedure here is authenticated. The one anonymous share surface is
 * `sharedTrace.get`, which ADR-057 keeps separate and which this mount does
 * not touch.
 */
import {
  PinnedTraceTrpcApi,
  ShareTrpcApi,
  type PinnedTraceTrpcContext,
  type ShareTrpcContext,
} from "@langwatch/share-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { appTrpcPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type ShareMount<
  TContext extends ShareTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
}>;

/** Mounts `share.*` on the app process's tRPC root. */
export function createShareTrpcRouter<
  TContext extends ShareTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: ShareMount<TContext, TOptions, TRoot>) {
  return ShareTrpcApi.create(mount.root, {
    protected: mount.protectedProcedure,
    policy: appTrpcPolicy(mount.middlewares),
  });
}

type PinnedTraceMount<
  TContext extends PinnedTraceTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
}>;

/** Mounts `pinnedTrace.*` on the app process's tRPC root. */
export function createPinnedTraceTrpcRouter<
  TContext extends PinnedTraceTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: PinnedTraceMount<TContext, TOptions, TRoot>) {
  return PinnedTraceTrpcApi.create(mount.root, {
    protected: mount.protectedProcedure,
    policy: appTrpcPolicy(mount.middlewares),
  });
}
