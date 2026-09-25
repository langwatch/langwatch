import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
/**
 * A real `OpsApp` over memory repositories, fixture peers and a literal
 * members record. Every collaborator a test wants to watch is passed in
 * rather than reached for.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";

import { MemoryOpsRepositories } from "../../repositories/memory/memory.ops.repositories.ts";
import type { OpsRepositories } from "../../repositories/ops.repositories.ts";
import {
  OpsApp,
  type OpsAppInfrastructure,
  type OpsCapability,
  type OpsEventingIntrospection,
} from "../ops.app.ts";

/** The staff address every fixture operator is measured against. */
export const OPS_STAFF_ADDRESS = "staff@langwatch.ai";

/** Nothing registered: the graph a test does not care about. */
class EmptyOpsIntrospection implements OpsEventingIntrospection {
  projections() {
    return [];
  }
  killSwitches() {
    return [];
  }
  processManagers() {
    return [];
  }
  dejaViewProjections() {
    return [];
  }
}

export type OpsTestAppOptions = Readonly<{
  capability?: Partial<OpsCapability>;
  members?: Partial<OpsAppInfrastructure>;
  auditLog?: AuditLogApi;
  apiKeys?: ApiKeyApi;
  projects?: ProjectApi;
  featureFlags?: FeatureFlagApi;
  repositories?: OpsRepositories;
}>;

export type OpsTestApp = Readonly<{ app: OpsApp; repositories: OpsRepositories }>;

/** The members record a process supplies, with nothing configured. */
export function createOpsTestInfrastructure(
  overrides: Partial<OpsAppInfrastructure> = {},
  capability: Partial<OpsCapability> = {},
): OpsAppInfrastructure {
  return {
    createCapability: () =>
      createApiFixture<OpsCapability>({
        snapshots: null,
        isAdmin: (identity: { email?: string | null }) => identity.email === OPS_STAFF_ADDRESS,
        ...capability,
      }),
    eventingIntrospection: new EmptyOpsIntrospection(),
    pipelines: { listRegistrations: () => ({ projections: [], eventSubscribers: [] }) },
    eventLogWindow: {
      read: () => ({ searchLookbackDays: 365, hotTierDays: null, hotTierEnvVar: null }),
    },
    grafana: { findLinkConfig: () => null },
    systemMigrations: createApiFixture<OpsAppInfrastructure["systemMigrations"]>({
      requiresOperatorConfirmation: () => false,
      enroll: async () => {},
      withdraw: async () => {},
      startPass: () => {},
    }),
    licenseRegistry: createApiFixture<OpsAppInfrastructure["licenseRegistry"]>({}),
    selfHostedInstances: createApiFixture<OpsAppInfrastructure["selfHostedInstances"]>({}),
    bugReportRateLimiter: { consume: async () => ({ allowed: true }) },
    bugReportNotifier: { notify: async () => {} },
    explainClients: { findClient: () => null },
    findOpsApiKey: () => null,
    findProductAnalyticsTargets: () => [],
    isProduction: false,
    ...overrides,
  };
}

export function createOpsTestApp(options: OpsTestAppOptions = {}): OpsTestApp {
  const repositories = options.repositories ?? MemoryOpsRepositories.create();

  const app = OpsApp.fromInfrastructure({
    infrastructure: createOpsTestInfrastructure(options.members, options.capability),
    dependencies: {
      users: createApiFixture<UserApi>(),
      auth: createApiFixture<AuthApi>(),
      identity: createApiFixture<IdentityApi>(),
      projects: options.projects ?? createApiFixture<ProjectApi>({ searchByQuery: async () => [] }),
      auditLog:
        options.auditLog ??
        createApiFixture<AuditLogApi>({ record: async () => ({ id: "audit", occurredAt: 0 }) }),
      apiKeys:
        options.apiKeys ?? createApiFixture<ApiKeyApi>({ findResolvedToken: async () => null }),
      featureFlags: options.featureFlags ?? createApiFixture<FeatureFlagApi>(),
    },
    repositories,
  });

  return { app, repositories };
}
