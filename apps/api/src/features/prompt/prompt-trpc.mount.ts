/**
 * App-process transport mounts for the prompt vertical.
 *
 * Behaviour is package-owned (`@langwatch/prompt-server`); this supplies the
 * process's root, authenticated procedure, policy chain and the nurturing
 * side effect a new prompt triggers.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  PromptTagTrpcApi,
  PromptTrpcApi,
  type PromptTrpcContext,
  type PromptTrpcPorts,
} from "@langwatch/prompt-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `prompts.*` on the app process's tRPC root. */
export function createPromptTrpcRouter<
  TContext extends PromptTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<PromptTrpcPorts>) {
  return PromptTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/** Mounts `promptTags.*` on the app process's tRPC root. */
export function createPromptTagTrpcRouter<
  TContext extends PromptTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  return PromptTagTrpcApi.create(mount.root, createTrpcApiService(mount));
}
