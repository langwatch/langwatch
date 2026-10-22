import { bindTrpcMiddlewareContext, type TrpcRuntimeContext } from "@langwatch/api/trpc";
import type { IdentityApi, IdentityServerConfig } from "@langwatch/identity-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { IdentityModule } from "./app/identity.app.ts";
import { identityChannels } from "./channels/identity-channels.registry.ts";
import { identityEventing } from "./eventing/identity.pipeline.ts";
import { identityPipelineEventing } from "./eventing/user-identity.pipeline.ts";
import { joinRequestEventing } from "./features/join-request/eventing/join-request.pipeline.ts";
import { twoStepRequirementEventing } from "./features/mfa/eventing/two-step-requirement.pipeline.ts";
import { ssoConnectionEventing } from "./features/sso-connection/eventing/sso-connection.pipeline.ts";
import { identityRepositories } from "./repositories/identity-repositories.registry.ts";
import { identityLookupTrpcTransport } from "./transport/identity-lookup.trpc.ts";
import { identityTrpcTransport } from "./transport/identity.trpc.ts";
import { joinRequestTrpcTransport } from "./transport/join-request.trpc.ts";
import {
  twoStepRequestHeadersContext,
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
  .provideMiddlewareBindings(() => [
    bindTrpcMiddlewareContext(
      twoStepRequestHeadersContext,
      (context: TrpcRuntimeContext) => context.req?.headers ?? null,
    ),
  ])
  .withEventing(identityEventing)
  .withEventing(identityPipelineEventing)
  .withEventing(joinRequestEventing)
  .withEventing(ssoConnectionEventing)
  .withEventing(twoStepRequirementEventing)
  .withMigrations(({ app, repositories }) => {
    const backfill = app.identifierBackfillMigration();
    const heal = app.secretHealMigration();
    const ownership = app.ssoDomainOwnershipMigration();
    return [
      // Were ops-held under their legacy names; ops copies their finished tenants and enrolments.
      // Each waits for old writers, since an older image still drives the legacy name (S6-COPY).
      defineMigrationStep({
        id: "identity:identifier-backfill",
        kind: "tenant",
        mode: "background",
        tenants: "user",
        title: backfill.title,
        description: backfill.description,
        requiresOperatorConfirmation: backfill.requiresOperatorConfirmation,
        runsAutomaticallyOnSelfHosted: backfill.runsAutomaticallyOnSelfHosted,
        enrolledAutomatically: backfill.enrolledAutomatically,
        needsOldWritersGone: true,
        ...(backfill.pauseWhileQueuedAbove === undefined
          ? {}
          : { pauseWhileQueuedAbove: backfill.pauseWhileQueuedAbove }),
        migrateTenant: (args) => backfill.migrateTenant(args),
      }),
      defineMigrationStep({
        id: "identity:secret-heal",
        kind: "tenant",
        mode: "background",
        tenants: "user",
        title: heal.title,
        description: heal.description,
        requiresOperatorConfirmation: heal.requiresOperatorConfirmation,
        runsAutomaticallyOnSelfHosted: heal.runsAutomaticallyOnSelfHosted,
        enrolledAutomatically: heal.enrolledAutomatically,
        needsOldWritersGone: true,
        ...(heal.migratedIsSteady ? { migratedIsSteady: true } : {}),
        ...(heal.candidateTenants ? { candidateTenants: heal.candidateTenants } : {}),
        migrateTenant: (args) => heal.migrateTenant(args),
      }),
      ...app.findConnectionGrandfatherMigrations().map((grandfather) =>
        defineMigrationStep({
          id: "identity:connection-grandfather",
          kind: "tenant",
          mode: "background",
          tenants: "organization",
          title: grandfather.title,
          description: grandfather.description,
          requiresOperatorConfirmation: grandfather.requiresOperatorConfirmation,
          runsAutomaticallyOnSelfHosted: grandfather.runsAutomaticallyOnSelfHosted,
          enrolledAutomatically: grandfather.enrolledAutomatically,
          needsOldWritersGone: true,
          migrateTenant: (args) => grandfather.migrateTenant(args),
        }),
      ),
      defineMigrationStep({
        id: "identity:sso-domain-ownership-backfill",
        kind: "tenant",
        mode: "background",
        tenants: "organization",
        title: ownership.title,
        description: ownership.description,
        requiresOperatorConfirmation: ownership.requiresOperatorConfirmation,
        runsAutomaticallyOnSelfHosted: ownership.runsAutomaticallyOnSelfHosted,
        enrolledAutomatically: ownership.enrolledAutomatically,
        needsOldWritersGone: true,
        migrateTenant: (args) => ownership.migrateTenant(args),
      }),
      // Background only: a blocking step may not touch a sign-in table (UIW-IDENTITY-STEP,
      // Alex 2026-10-09). Waits for old writers, which re-finalize reopened accounts.
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
      // Separate the switch (Alex, 2026-10-12): sign-in reads identity's own row beside ops' older
      // one; this fills it once no older image writes the older one. Spec: sign-in-switch.feature.
      defineMigrationStep({
        id: "identity:carry-over-sign-in-switch",
        kind: "data",
        mode: "background",
        description:
          "Copies which users sign in on the identifier path from the migration state table into identity's own sign-in switch.",
        needsOldWritersGone: true,
        run: async ({ dryRun }) => {
          const copied = await repositories.migration.carryOverSignInSwitch({ dryRun });
          return dryRun ? { wouldCopy: copied } : { copied };
        },
      }),
      // After auth clears `Account`: before that, the secret heal could carry a token still on
      // an `Account` row back into its credential (provider-token-discard.feature).
      defineMigrationStep({
        id: "identity:discard-provider-tokens",
        kind: "data",
        mode: "background",
        description:
          "Clears the OAuth access, refresh and ID tokens kept on sign-in credentials; sign-in no longer stores them.",
        needsOldWritersGone: true,
        after: ["auth:discard-provider-tokens"],
        run: async ({ dryRun }) => {
          const cleared = await repositories.migration.discardProviderTokens({ dryRun });
          return dryRun ? { wouldClear: cleared } : { cleared };
        },
      }),
    ];
  });
