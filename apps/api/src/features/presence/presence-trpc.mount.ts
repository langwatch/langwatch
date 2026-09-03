/**
 * App-process transport mount for the presence vertical.
 *
 * Behaviour is package-owned (`@langwatch/presence-server`); this supplies the
 * process's tRPC root, its authenticated procedure and its policy chain, and
 * nothing else. Presence takes no ports: every answer it gives — who is in the
 * project, where their cursor is, whether the feature is on for the project —
 * is read off the request context's own application slice, so there is no
 * capability left for the process to hand over.
 *
 * Two of the four procedures are SUBSCRIPTIONS (`onPresenceUpdate`,
 * `onPresenceCursor`), which is why the mount belongs in the feature record
 * rather than beside it: the subscription lane resolves a path on the caller
 * built from the process's root, so a namespace mounted outside the record
 * would be callable and un-watchable.
 */
import { createTrpcApiService, type TrpcApiMount } from "@langwatch/api/trpc";
import { PresenceTrpcApi, type PresenceTrpcContext } from "@langwatch/presence-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `presence.*` on the app process's tRPC root. */
export function createPresenceTrpcRouter<
  TContext extends PresenceTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  return PresenceTrpcApi.create(mount.root, createTrpcApiService(mount));
}
