import { bindTrpcFact, type TrpcRuntimeContext } from "@langwatch/api/trpc";
import type { IdentityApi, IdentityServerConfig } from "@langwatch/identity-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { IdentityModule } from "./app/identity.app.ts";
import { identityChannels } from "./channels/identity-channels.registry.ts";
import { identityEventing } from "./eventing/identity.pipeline.ts";
import { identityPipelineEventing } from "./eventing/user-identity.pipeline.ts";
import { joinRequestEventing } from "./features/join-request/eventing/join-request.pipeline.ts";
import { ssoConnectionEventing } from "./features/sso-connection/eventing/sso-connection.pipeline.ts";
import { identityRepositories } from "./repositories/identity-repositories.registry.ts";
import { identityLookupTrpcTransport } from "./transport/identity-lookup.trpc.ts";
import { identityTrpcTransport } from "./transport/identity.trpc.ts";
import { joinRequestTrpcTransport } from "./transport/join-request.trpc.ts";
import {
  twoStepRequestHeadersFact,
  twoStepVerificationTrpcTransport,
} from "./transport/two-step-verification.trpc.ts";

export const identityProcessModule: PublishedProcessModule<
  "identity",
  IdentityApi,
  IdentityServerConfig
> = defineProcessModule("identity")
  .withRepositories(identityRepositories)
  .withChannels(identityChannels)
  .withApi(IdentityModule)
  .withTransports(
    identityLookupTrpcTransport,
    identityTrpcTransport,
    joinRequestTrpcTransport,
    twoStepVerificationTrpcTransport,
  )
  .withTransportFacts(() => [
    bindTrpcFact(
      twoStepRequestHeadersFact,
      (context: TrpcRuntimeContext) => context.req?.headers ?? null,
    ),
  ])
  .withEventing(identityEventing)
  .withEventing(identityPipelineEventing)
  .withEventing(joinRequestEventing)
  .withEventing(ssoConnectionEventing)
  .withMigrations(({ repositories }) => [
    // Blocking, so it has run before a release that adopts unproven accounts serves. A state
    // flip, idempotent: a second run finds nothing (Alex, 2026-10-06, "Adopt gap").
    defineMigrationStep({
      id: "identity:reopen-unproven-accounts",
      kind: "data",
      mode: "blocking",
      description:
        "Returns accounts never confirmed and never signed into to the legacy sign-in path.",
      run: async ({ dryRun }) => {
        const reopened = await repositories.migration.reopenUnprovenAccounts({ dryRun });
        return dryRun ? { wouldReopen: reopened } : { reopened };
      },
    }),
    // An older pod's system-migrations pass re-finalizes reopened accounts:
    // sweep again once none serves.
    defineMigrationStep({
      id: "identity:reopen-unproven-accounts-after-rollout",
      kind: "data",
      mode: "background",
      description:
        "Returns accounts an older image finalized during the rollout to the legacy sign-in path.",
      needsOldWritersGone: true,
      run: async ({ dryRun }) => {
        const reopened = await repositories.migration.reopenUnprovenAccounts({ dryRun });
        return dryRun ? { wouldReopen: reopened } : { reopened };
      },
    }),
  ]);
