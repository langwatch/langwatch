/**
 * App-process transport mount for the setup-skill catalogue.
 *
 * Behaviour is package-owned (`@langwatch/langy-server`, because the bodies are
 * the compiled skills the Langy image ships); this supplies the process's root,
 * authenticated procedure and policy chain. It takes no ports: the catalogue is
 * a compiled artifact the package holds, so there is nothing for the process to
 * answer.
 */
import { createTrpcApiService, type TrpcApiMount } from "@langwatch/api/trpc";
import { SetupSkillsTrpcApi, type SetupSkillsTrpcContext } from "@langwatch/langy-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `setupSkills.*` on the app process's tRPC root. */
export function createSetupSkillsTrpcRouter<
  TContext extends SetupSkillsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  return SetupSkillsTrpcApi.create(mount.root, createTrpcApiService(mount));
}
