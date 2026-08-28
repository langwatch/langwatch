/**
 * App-process transport mount for machine translation.
 *
 * Behaviour is package-owned (`@langwatch/model-provider-server`); this
 * supplies the process's root, authenticated procedure, policy chain and the
 * one port the model-provider package does not own — the application's
 * provider-failure policy, which decides what a customer is told when a model
 * call fails and where the provider's own words are logged.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  TranslateTrpcApi,
  type TranslateTrpcContext,
  type TranslateTrpcPorts,
} from "@langwatch/model-provider-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `translate.*` on the app process's tRPC root. */
export function createTranslateTrpcRouter<
  TContext extends TranslateTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<TranslateTrpcPorts>) {
  return TranslateTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}
