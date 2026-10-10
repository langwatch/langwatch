// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One SCIM application over a fake directory service, for the transport tests:
 * the same object the six doors are mounted on, so what a test drives is the
 * declaration and the application, never a stand-in for either.
 *
 * Built through {@link ScimModule.createWithService}, not {@link ScimModule.create}:
 * the production path also resolves four peers it needs only to build the
 * `ScimService` (`AuthzApi`, `UserApi`, `AuthApi`, `GovernanceRestApi`) and reads
 * `prisma` off the process, none of which a transport test has a use for.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type {
  ScimDirectoryOwnership,
  ScimRequestLogEntry,
  ScimRequestLogQuery,
  ScimRequestRecord,
  ScimTokenEntitlement,
  ScimSyncActivityEntry,
} from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { OrganizationSsoConnection } from "@langwatch/identity-contract";
import type { Instant } from "@langwatch/time";
import { vi } from "vitest";

import { foldedConnectionReads } from "../../../__tests__/support/folded-connections.ts";
import { ScimModule } from "../../../app/scim.app.ts";
import { ScimConnectionsService } from "../../../services/scim-connections.service.ts";
import { ScimDirectoryExternalIdsService } from "../../../services/scim-directory-external-ids.service.ts";
import type { ScimOversightService } from "../../../services/scim-oversight.service.ts";
import { ScimReconciliationService } from "../../../services/scim-reconciliation.service.ts";
import { ScimTokenMintService } from "../../../services/scim-token-mint.service.ts";
import type { ScimService } from "../../../services/scim.service.ts";

export class ScimServiceFake implements Pick<ScimService, keyof ScimService> {
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
  readonly recordTokenUse = vi.fn(async (_input: { tokenId: string }): Promise<void> => void 0);
  readonly getUser = vi.fn();
  readonly replaceUser = vi.fn();
  readonly updateUser = vi.fn();
  readonly listGroups = vi.fn();
  readonly getGroup = vi.fn();
  readonly createGroup = vi.fn();
  readonly replaceGroup = vi.fn();
  readonly updateGroup = vi.fn();
  readonly deleteGroup = vi.fn();
  readonly toScimUser = vi.fn();
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
    scim?: Pick<ScimService, keyof ScimService>;
    connections?: OrganizationSsoConnection[];
    webhookSecret?: string | undefined;
    planType?: string;
    oversight?: ScimOversightService;
    /** The users the platform-operator grant answers yes for. */
    platformOperators?: readonly string[];
    activity?: ScimSyncActivityEntry[];
    /** What authz answers a token minter lacks of an organization admin's permissions. */
    minterLacks?: string[];
  } = {},
) {
  const findPermissionsBeyondCaller = vi.fn(
    async (_input: Parameters<AuthzApi["findPermissionsBeyondCaller"]>[0]) =>
      options.minterLacks ?? [],
  );
  const scim = options.scim ?? new ScimServiceFake();
  const offered = options.connections ?? [];
  const folded = foldedConnectionReads(offered);
  const audited: unknown[] = [];
  const entitlements: Pick<EntitlementApi, "getActivePlan"> = {
    getActivePlan: () => Promise.resolve(fakePlan(options.planType ?? "ENTERPRISE")),
  };
  const auditLog: Pick<AuditLogApi, "record"> = {
    record: (entry) => {
      audited.push(entry);
      return Promise.resolve({ id: "audit", occurredAt: 0 });
    },
  };
  const connections = ScimConnectionsService.create(folded);
  const app = ScimModule.createWithService({
    scim,
    connections,
    directoryExternalIds: ScimDirectoryExternalIdsService.create({
      connections,
      identities: {
        findDirectoryExternalIds: () => Promise.resolve([]),
        findUserResource: () => Promise.resolve(null),
        findDirectoryConnectionsForUser: () => Promise.resolve([]),
      },
    }),
    reconciliation: ScimReconciliationService.create({
      connections,
      syncs: {
        findForOrganization: () => Promise.resolve([]),
        findByConnection: () => Promise.resolve(null),
        findActivity: () => Promise.resolve(options.activity ?? []),
      },
      grants: { findDirectoryCausedChanges: () => Promise.resolve([]) },
      people: { getProfiles: () => Promise.resolve([]) },
      directory: scim,
    }),
    entitlements,
    auditLog,
    webhookSecret: () => ("webhookSecret" in options ? options.webhookSecret : undefined),
    minting: ScimTokenMintService.create({ findPermissionsBeyondCaller }),
    ...(options.oversight ? { oversight: options.oversight } : {}),
    ...(options.platformOperators
      ? {
          platformOperators: {
            can: async ({ principal, permission, scope }) =>
              scope.type === "platform" &&
              permission.startsWith("ops:") &&
              principal.type === "user" &&
              !!options.platformOperators?.includes(principal.id),
          },
        }
      : {}),
  });

  return { app, scim, audited, findPermissionsBeyondCaller };
}
