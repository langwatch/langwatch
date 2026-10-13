import { organizationCredentialOfRequest } from "@langwatch/api/rest";
import type { AuthzApi, AuthzServerConfig } from "@langwatch/authz-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { AuthzModule } from "./app/authz.app.ts";
import { authzAggregateReadEventing } from "./eventing/authz-aggregate-read.pipeline.ts";
import { authzEventing } from "./eventing/authz-grant.pipeline.ts";
import { authzMemberOffboardedEventing } from "./eventing/authz-member-offboarded.pipeline.ts";
import { authzRepositories } from "./repositories/authz-repositories.registry.ts";
import { authzGrantRest } from "./transport/authz-grant.rest.ts";
import { authzRoleBindingRest } from "./transport/authz-role-binding.rest.ts";
import { authzTrpcTransport } from "./transport/authz.trpc.ts";

function organizationContextOf(credential: {
  organizationId: string;
  apiKeyId: string;
  userId: string | null;
}) {
  return {
    organizationId: credential.organizationId,
    actor: credential.userId
      ? { type: "user" as const, id: credential.userId }
      : { type: "system" as const, id: null },
    caller: { type: "apiKey" as const, id: credential.apiKeyId },
  };
}

export const authzProcessModule: PublishedProcessModule<"authz", AuthzApi, AuthzServerConfig> =
  defineProcessModule("authz")
    .withRepositories(authzRepositories)
    .withApi(AuthzModule)
    .withTransports(authzGrantRest, authzRoleBindingRest, authzTrpcTransport)
    // The ledger row records the member behind the key, or the system where the
    // key acts as nobody: a service key is not a person and must not be written
    // into the trail as one.
    // Escalation is bounded by the key itself, never by its owner's wider standing.
    .provideMiddlewareContext({
      roleBindingRestContext: (request) =>
        organizationContextOf(organizationCredentialOfRequest(request)),
      grantRestContext: (request) =>
        organizationContextOf(organizationCredentialOfRequest(request)),
    })
    .withEventing(authzEventing)
    .withEventing(authzAggregateReadEventing)
    .withEventing(authzMemberOffboardedEventing)
    .withMigrations(({ app, repositories }) => {
      const engine = app.engineMigration();
      return [
        // Was ops-held as "authz-engine"; ops copies its finished tenants and enrolments. Waits
        // for old writers, since an older image still drives the legacy name (S6-COPY).
        defineMigrationStep({
          id: "authz:engine",
          kind: "tenant",
          mode: "background",
          tenants: "organization",
          title: engine.title,
          description: engine.description,
          requiresOperatorConfirmation: engine.requiresOperatorConfirmation,
          runsAutomaticallyOnSelfHosted: engine.runsAutomaticallyOnSelfHosted,
          enrolledAutomatically: engine.enrolledAutomatically,
          needsOldWritersGone: true,
          migrateTenant: (args) => engine.migrateTenant(args),
        }),
        // Separate the switch (Alex, 2026-10-12): the gate reads authz's own row beside ops' older
        // one; this fills it once no older image writes the older one (engine-switch.feature).
        defineMigrationStep({
          id: "authz:carry-over-engine-switch",
          kind: "data",
          mode: "background",
          description:
            "Copies which organizations the authorization engine answers for from the migration state table into authz's own engine switch.",
          needsOldWritersGone: true,
          run: async ({ dryRun }) => {
            const copied = await repositories.cutover.carryOverEngineSwitch({ dryRun });
            return dryRun ? { wouldCopy: copied } : { copied };
          },
        }),
      ];
    });
