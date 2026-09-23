// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One SCIM application over a fake directory service, for the transport tests:
 * the same object the four doors are mounted on, so what a test drives is the
 * declaration and the application, never a stand-in for either.
 *
 * Built through {@link ScimApp.createWithService}, not {@link ScimApp.create}:
 * the production path also resolves four peers it needs only to build the
 * `ScimService` (`AuthzApi`, `UserApi`, `AuthApi`, `GovernanceRestApi`) and reads
 * `prisma` off the process, none of which a transport test has a use for.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  ScimService,
  type ScimDirectoryOwnership,
  type ScimRequestLogEntry,
  type ScimRequestLogQuery,
  type ScimRequestRecord,
  type ScimTokenEntitlement,
} from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { OrganizationSsoConnection } from "@langwatch/identity-contract";
import type { Instant } from "@langwatch/time";
import { vi } from "vitest";

import { ScimApp } from "../../../app/scim.app.ts";
import {
  ScimConnectionsService,
  type ScimConnectionReads,
} from "../../../services/scim-connections.service.ts";
import type { ScimOversightService } from "../../../services/scim-oversight.service.ts";
import { ScimReconciliationService } from "../../../services/scim-reconciliation.service.ts";

export class ScimServiceFake extends ScimService {
  readonly verifyToken = vi.fn(
    async (_input: { token: string }): Promise<ScimTokenEntitlement> => ({
      status: "invalid_token",
    }),
  );
  readonly createUser = vi.fn();
  readonly recordRequest = vi.fn(async (_request: ScimRequestRecord): Promise<void> => void 0);
  readonly findRequestLog = vi.fn(
    async (_query: ScimRequestLogQuery): Promise<ScimRequestLogEntry[]> => [],
  );
  readonly sweepExpiredRequests = vi.fn(async (_input: { now: Instant }): Promise<number> => 0);
  readonly findDirectoryOwnership = vi.fn(
    async (_input: { connectionIds: string[] }): Promise<ScimDirectoryOwnership[]> => [],
  );
  readonly findOrganizationBySsoDomain = vi.fn();
  readonly listUsers = vi.fn();
  readonly deleteUser = vi.fn();
  readonly generateToken = vi.fn();
  readonly listTokens = vi.fn();
  readonly revokeToken = vi.fn();
  readonly revokeTokensForConnection = vi.fn();
  readonly getUser = vi.fn();
  readonly replaceUser = vi.fn();
  readonly updateUser = vi.fn();
  readonly listGroups = vi.fn();
  readonly getGroup = vi.fn();
  readonly createGroup = vi.fn();
  readonly replaceGroup = vi.fn();
  readonly updateGroup = vi.fn();
  readonly deleteGroup = vi.fn();
}

/** A minimal but complete plan, at the type the doors only ever read `.type` off. */
function fakePlan(type: string): Plan {
  return {
    planSource: "subscription",
    type,
    name: type,
    free: false,
    maxMembers: 0,
    maxMembersLite: 0,
    maxMessagesPerMonth: 0,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  };
}

/** One application, and the audit entries it recorded. */
export function scimTestApp(
  options: {
    scim?: ScimService;
    connections?: OrganizationSsoConnection[];
    webhookSecret?: string | undefined;
    planType?: string;
    oversight?: ScimOversightService;
    operators?: Parameters<typeof ScimApp.createWithService>[0]["operators"];
  } = {},
) {
  const scim = options.scim ?? new ScimServiceFake();
  const offered = options.connections ?? [];
  const identity: ScimConnectionReads = {
    ssoConnectionReads: () => ({
      findForOrganization: () => Promise.resolve(offered),
      getProvider: ({ connectionId }) => Promise.resolve({ connectionId, providerId: "oidc" }),
      getOrganization: () => Promise.reject(new Error("the doors never ask")),
    }),
  };
  const audited: unknown[] = [];
  const entitlements: Pick<EntitlementApi, "getActivePlan"> = {
    getActivePlan: () => Promise.resolve(fakePlan(options.planType ?? "ENTERPRISE")),
  };
  const auditLog: Pick<AuditLogApi, "record"> = {
    record: (entry) => {
      audited.push(entry);
      return Promise.resolve();
    },
  };
  const app = ScimApp.createWithService({
    scim,
    connections: ScimConnectionsService.create(identity),
    reconciliation: ScimReconciliationService.create({
      identity: {
        ...identity,
        scimSyncReads: () => ({
          findForOrganization: () => Promise.resolve([]),
          findByConnection: () => Promise.resolve(null),
          listForOperator: () => Promise.resolve({ syncs: [], total: 0 }),
          findForOperator: () => Promise.resolve([]),
        }),
      },
      grants: { findDirectoryCausedChanges: () => Promise.resolve([]) },
      people: { getProfiles: () => Promise.resolve([]) },
      directory: scim,
    }),
    entitlements,
    auditLog,
    webhookSecret: () => ("webhookSecret" in options ? options.webhookSecret : undefined),
    ...(options.oversight ? { oversight: options.oversight } : {}),
    ...(options.operators ? { operators: options.operators } : {}),
  });

  return { app, scim, audited };
}
