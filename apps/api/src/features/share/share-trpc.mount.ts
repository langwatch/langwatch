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
import { createTrpcApiService, type TrpcApiMount } from "@langwatch/api/trpc";
import {
  PinnedTraceTrpcApi,
  ShareTrpcApi,
  type PinnedTraceTrpcContext,
  type ShareTrpcContext,
} from "@langwatch/share-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `share.*` on the app process's tRPC root. */
export function createShareTrpcRouter<
  TContext extends ShareTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  return ShareTrpcApi.create(mount.root, createTrpcApiService(mount));
}

/** Mounts `pinnedTrace.*` on the app process's tRPC root. */
export function createPinnedTraceTrpcRouter<
  TContext extends PinnedTraceTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  return PinnedTraceTrpcApi.create(mount.root, createTrpcApiService(mount));
}
