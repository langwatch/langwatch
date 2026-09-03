/**
 * App-process transport mount for the topic vertical: the clusters a project's
 * traces were grouped into, and the run that rebuilds them.
 *
 * Behaviour is package-owned (`@langwatch/topic-server`); this supplies the
 * process's tRPC root, its authenticated procedure and its policy chain. The
 * surface takes no ports — every answer is read off `ctx.app.topics`.
 */
import { createTrpcApiService, type TrpcApiMount } from "@langwatch/api/trpc";
import { TopicTrpcApi, type TopicTrpcContext } from "@langwatch/topic-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `topics.*` on the app process's tRPC root. */
export function createTopicTrpcRouter<
  TContext extends TopicTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  return TopicTrpcApi.create(mount.root, createTrpcApiService(mount));
}
