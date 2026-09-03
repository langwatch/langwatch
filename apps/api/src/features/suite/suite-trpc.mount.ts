/**
 * App-process transport mount for the suite vertical.
 *
 * Behaviour is package-owned (`@langwatch/suite-server`); this supplies the
 * process's root, authenticated procedure and policy chain.
 */
import { createTrpcApiService, type TrpcApiMount } from "@langwatch/api/trpc";
import { SuiteTrpcApi, type SuiteTrpcContext } from "@langwatch/suite-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `suites.*` (including `suites.folders.*`) on the app's tRPC root. */
export function createSuiteTrpcRouter<
  TContext extends SuiteTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  return SuiteTrpcApi.create(mount.root, createTrpcApiService(mount));
}
