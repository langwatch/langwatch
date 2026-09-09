/**
 * A real `OpsApp` over memory repositories, fixture peers and a literal
 * infrastructure record. Every collaborator a test wants to watch is passed in
 * rather than reached for.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";

import { OpsApp, type OpsAppInfrastructure, type OpsCapability } from "../ops.app.ts";
import { MemoryOpsRepositories } from "../../repositories/memory/memory.ops.repositories.ts";
import type { OpsRepositories } from "../../repositories/ops.repositories.ts";
import { OpsEventingIntrospectionPort } from "../../ports/eventing-introspection.port.ts";

/** The staff address every fixture operator is measured against. */
export const OPS_STAFF_ADDRESS = "staff@langwatch.ai";

/** Nothing registered: the graph a test does not care about. */
class EmptyOpsIntrospection extends OpsEventingIntrospectionPort {
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
  infrastructure?: Partial<OpsAppInfrastructure>;
  auditLog?: AuditLogApi;
  apiKeys?: ApiKeyApi;
  projects?: ProjectApi;
  repositories?: OpsRepositories;
}>;

export type OpsTestApp = Readonly<{ app: OpsApp; repositories: OpsRepositories }>;

/** The infrastructure record a process supplies, with nothing configured. */
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
    featureFlags: createApiFixture<FeatureFlagApi>(),
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
    bugReportRateLimiter: { consume: async () => ({ allowed: true }) },
    bugReportNotifier: { notify: async () => {} },
    explainClients: { findClient: () => null },
    findOpsApiKey: () => null,
    isProduction: false,
    ...overrides,
  };
}

export function createOpsTestApp(options: OpsTestAppOptions = {}): OpsTestApp {
  const repositories = options.repositories ?? MemoryOpsRepositories.create();

  const app = OpsApp.create({
    infrastructure: createOpsTestInfrastructure(options.infrastructure, options.capability),
    dependencies: {
      users: createApiFixture<UserApi>(),
      auth: createApiFixture<AuthApi>(),
      projects:
        options.projects ?? createApiFixture<ProjectApi>({ searchByQuery: async () => [] }),
      auditLog: options.auditLog ?? createApiFixture<AuditLogApi>({ record: async () => {} }),
      apiKeys:
        options.apiKeys ?? createApiFixture<ApiKeyApi>({ findResolvedToken: async () => null }),
    },
    config: undefined,
    repositories,
    resources: new ResourceScope(),
  });

  return { app, repositories };
}
