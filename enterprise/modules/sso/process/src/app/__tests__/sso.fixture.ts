// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { ssoSecrets, type SsoConfig } from "@langwatch/enterprise-sso-contract";
import type { IdentityApi, SsoConnectionBackofficeApi } from "@langwatch/identity-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { OpsApi } from "@langwatch/ops-contract";
import { ScopedSecrets, type SecretHandle } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/api-fixture";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { vi } from "vitest";

import { SsoApp, type SsoInfrastructure } from "../sso.app.ts";
import type { SsoConnectionLedger, SsoGateLogger } from "../sso.members.ts";

/** The one operator on the staff list, exactly as `ADMIN_EMAILS` decides it. */
export const SSO_TEST_STAFF_EMAIL = "olive@langwatch.ai";

export function createSsoTestConfig(overrides: Partial<SsoConfig> = {}): SsoConfig {
  return {
    provider: "auth0",
    googleClientId: undefined,
    githubClientId: undefined,
    gitlabClientId: undefined,
    azureAdClientId: undefined,
    azureAdTenantId: undefined,
    auth0ClientId: "client",
    auth0Issuer: "https://acme.auth0.com",
    oktaClientId: undefined,
    oktaIssuer: undefined,
    cognitoClientId: undefined,
    cognitoIssuer: undefined,
    oneLoginClientId: undefined,
    oneLoginIssuer: undefined,
    oidcClientId: undefined,
    oidcIssuer: undefined,
    ...overrides,
  };
}

type SsoSecretOverrides = Partial<{
  [Key in keyof typeof ssoSecrets]: string | undefined;
}>;

/** A scoped secrets double: resolves configured overrides, `undefined` otherwise. */
export function createSsoTestSecrets(overrides: SsoSecretOverrides = {}): ScopedSecrets {
  const byId = new Map<string, string | undefined>(
    (Object.keys(ssoSecrets) as (keyof typeof ssoSecrets)[]).map((key) => [
      ssoSecrets[key].id,
      overrides[key],
    ]),
  );
  return new ScopedSecrets(
    async (handle: SecretHandle<unknown>, build: (value: unknown) => unknown) =>
      build(byId.get(handle.id)),
  );
}

/** Nothing on the back office asks the licence gate; a call would be a surprise. */
export function createSsoTestLicensing(): LicensingApi {
  return createApiFixture<LicensingApi>({
    inspectPlatformAccess: async () => ({ allowed: false, inspections: [] }),
  });
}

export function createSsoTestOperators(staffEmail = SSO_TEST_STAFF_EMAIL): OpsApi {
  return createApiFixture<OpsApi>({
    isAdmin: (identity) => identity.email === staffEmail,
  });
}

function testProfile(id: string, email: string | null): UserProfile {
  return {
    id,
    name: null,
    email,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastLoginAt: null,
    deactivatedAt: null,
  };
}

export function createSsoTestUsers(profiles: Record<string, string | null> = {}): UserApi {
  return createApiFixture<UserApi>({
    findById: async ({ id }) => (id in profiles ? testProfile(id, profiles[id] ?? null) : null),
  });
}

export function createSsoTestAuditLog(): AuditLogApi {
  return createApiFixture<AuditLogApi>({ record: async () => {} });
}

/**
 * Every ledger verb, recorded, so a test reads what was commanded. Typed
 * against identity's own backoffice shape — the strictest of the two
 * equivalent interfaces sso and identity each declare — so the same double
 * satisfies both `SsoConnectionLedger` (structurally, narrow-to-wide) and the
 * `IdentityApi.ssoBackoffice()` peer this fixture stands in for.
 */
type Ledger = SsoConnectionBackofficeApi;

export class RecordingSsoConnectionLedger implements SsoConnectionLedger, Ledger {
  static create(): RecordingSsoConnectionLedger {
    return new RecordingSsoConnectionLedger();
  }

  readonly list = vi.fn<Ledger["list"]>(async () => ({ connections: [], total: 0 }));
  readonly findById = vi.fn<Ledger["findById"]>(async () => null);
  readonly registerConnection = vi.fn<Ledger["registerConnection"]>(async () => ({
    connectionId: "",
  }));
  readonly claimDomain = vi.fn<Ledger["claimDomain"]>(async () => {});
  readonly approveDomainClaim = vi.fn<Ledger["approveDomainClaim"]>(async () => {});
  readonly rejectDomainClaim = vi.fn<Ledger["rejectDomainClaim"]>(async () => {});
  readonly attestDomain = vi.fn<Ledger["attestDomain"]>(async () => {});
  readonly activateConnection = vi.fn<Ledger["activateConnection"]>(async () => {});
  readonly suspendConnection = vi.fn<Ledger["suspendConnection"]>(async () => {});
  readonly resumeConnection = vi.fn<Ledger["resumeConnection"]>(async () => {});
  readonly requestTeardown = vi.fn<Ledger["requestTeardown"]>(async () => {});
}

/** The gate's log lines, kept so a test can read what an operator would. */
export class RecordingSsoGateLogger implements SsoGateLogger {
  static create(): RecordingSsoGateLogger {
    return new RecordingSsoGateLogger();
  }

  readonly info = vi.fn<SsoGateLogger["info"]>();
  readonly warn = vi.fn<SsoGateLogger["warn"]>();
}

/** The identity peer, narrowed to the one capability sso reads off it. */
export function createSsoTestIdentity(connections: SsoConnectionBackofficeApi): IdentityApi {
  return createApiFixture<IdentityApi>({ ssoBackoffice: () => connections });
}

export function createSsoTestApp(
  input: Readonly<{
    config?: SsoConfig;
    secrets?: SsoSecretOverrides;
    members?: Partial<SsoInfrastructure>;
    connections?: RecordingSsoConnectionLedger;
    dependencies?: Partial<{
      licensing: LicensingApi;
      operators: OpsApi;
      users: UserApi;
      auditLog: AuditLogApi;
      identity: IdentityApi;
    }>;
  }> = {},
): Promise<SsoApp> {
  const connections = input.connections ?? RecordingSsoConnectionLedger.create();
  return SsoApp.create({
    config: input.config ?? createSsoTestConfig(),
    dependencies: {
      licensing: input.dependencies?.licensing ?? createSsoTestLicensing(),
      operators: input.dependencies?.operators ?? createSsoTestOperators(),
      users: input.dependencies?.users ?? createSsoTestUsers(),
      auditLog: input.dependencies?.auditLog ?? createSsoTestAuditLog(),
      identity: input.dependencies?.identity ?? createSsoTestIdentity(connections),
    },
    members: {
      logger: input.members?.logger ?? RecordingSsoGateLogger.create(),
      publicBaseUrl: input.members?.publicBaseUrl ?? "https://acme.test",
      isSaas: input.members?.isSaas ?? false,
    },
    resources: new ResourceScope(),
    secrets: createSsoTestSecrets({ auth0ClientSecret: "secret", ...input.secrets }),
  });
}
