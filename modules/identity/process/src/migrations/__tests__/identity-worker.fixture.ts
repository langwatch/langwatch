/** The installed identity module on a worker over memory stores, for its migration step tests. */
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
import { isDeclaredMigrationStep, isMigrationStep } from "@langwatch/upgrade/step";
import type { UserApi } from "@langwatch/user-contract";

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
        identifierBackfillMaxQueuedJobs: 5000,
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

/** Boots identity and finds one declared step by id, refusing by name when it is not declared. */
export async function identityStep({ id }: { id: string }) {
  const runtime = await bootIdentity();
  const step = runtime
    .migrationSteps(isDeclaredMigrationStep)
    .filter(isMigrationStep)
    .find((candidate) => candidate.id === id);
  if (!step) {
    await runtime.stop();
    throw new Error(`step ${id} is not declared`);
  }
  return { runtime, step };
}

/** A step context with no checkpoint, no abort and a silent log. */
export function stepContext({ dryRun }: { dryRun: boolean }) {
  return {
    log: { info: () => undefined, warn: () => undefined },
    checkpoint: { resumeFrom: null, save: async () => undefined },
    signal: new AbortController().signal,
    dryRun,
  };
}
