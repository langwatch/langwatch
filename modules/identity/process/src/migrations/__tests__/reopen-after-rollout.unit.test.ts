// Spec: modules/identity/specs/identity-reopen-after-rollout.feature
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { EventSourcing } from "@langwatch/eventing";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { isMigrationStep } from "@langwatch/upgrade/step";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { identityProcessModule } from "../../identity.module.ts";

/** An empty secrets chain: every optional handle, the sign-ups webhook included, reads as unset. */
const noSecretsChain = SecretsResolver.over(SecretsChain.start({ environment: {} }));

/** An email-mode deployment: no federated provider, no licence, no passkeys, its own passwords. */
async function bootIdentity() {
  return createApp({
    role: "worker",
    secrets: (owner, declared) => noSecretsChain.scopeTo(owner, declared),
  })
    .withModules([identityProcessModule])
    .withStores(memoryStores())
    .withConfig({
      identity: {
        ssoDomainProofDnsServers: [],
        isSaas: false,
        publicBaseUrl: undefined,
        passkeysEnabled: false,
        mfaEnrollmentOpen: false,
        localPasswords: false,
      },
    })
    .withEventing(new EventSourcing({ enabled: false, processManagerMode: "producer-only" }))
    .provide({
      organization: createApiFixture<OrganizationApi>(),
      authz: createApiFixture<AuthzApi>(),
      auth: createApiFixture<AuthApi>({
        resolveAuthProvider: async () => "email",
        offersPasskeys: () => false,
        issuesOwnPasswords: () => false,
      }),
      user: createApiFixture<UserApi>(),
      entitlement: createApiFixture<EntitlementApi>(),
      "audit-log": createApiFixture<AuditLogApi>(),
      licensing: createApiFixture<LicensingApi>({ isPlatformSsoLicensed: async () => false }),
      scim: createApiFixture<ScimApi>(),
      notification: createApiFixture<NotificationService>(),
    })
    .boot();
}

const STEP = "identity:reopen-unproven-accounts-after-rollout";

async function stepOnFreshIdentity() {
  const runtime = await bootIdentity();
  const step = runtime.migrationSteps(isMigrationStep).find((candidate) => candidate.id === STEP);
  if (!step) throw new Error(`step ${STEP} is not declared`);
  return { runtime, step };
}

describe("identity's after-rollout reopen step", () => {
  /** @scenario "The after-rollout step is a background step that waits for old writers to go" */
  it("is a background step that needs old writers gone", async () => {
    const { runtime, step } = await stepOnFreshIdentity();
    try {
      expect(step).toMatchObject({ mode: "background", needsOldWritersGone: true });
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The after-rollout step makes the same sweep as the blocking step" */
  it("reports nothing reopened over an empty store, for a run and a dry run", async () => {
    const { runtime, step } = await stepOnFreshIdentity();
    const context = {
      checkpoint: { resumeFrom: null, save: async () => undefined },
      signal: new AbortController().signal,
    };
    try {
      expect(await step.run({ ...context, dryRun: false })).toEqual({ reopened: 0 });
      expect(await step.run({ ...context, dryRun: true })).toEqual({ wouldReopen: 0 });
    } finally {
      await runtime.stop();
    }
  });
});
