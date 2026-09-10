/**
 * Mounts the Langy module's `setupSkills.*` namespace: the setup instructions
 * the empty states copy for a coding agent. Reads nothing off the request
 * beyond the project the `project:view` permission is checked against, so
 * `ctx.app.langy` is resolved and handed over like any other declared
 * namespace, with no extra facts.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { LangyApi } from "@langwatch/langy-contract";
import { setupSkillsTrpcTransport } from "@langwatch/langy-server";

/** The one slice of the process context this namespace reads. */
export interface LangySetupSkillsHostContext {
  app: Readonly<{ langy: LangyApi }>;
}

/** Mounts `setupSkills.*` on the app process's declared tRPC runtime. */
export function createLangySetupSkillsTrpcRouters<
  TContext extends LangySetupSkillsHostContext,
>(runtime: TrpcRuntime<TContext>) {
  return {
    setupSkills: runtime.mount(setupSkillsTrpcTransport, (ctx) => ctx.app.langy),
  };
}
