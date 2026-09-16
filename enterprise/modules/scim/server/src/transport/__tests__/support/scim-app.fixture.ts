// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One SCIM application over a fake directory service, for the transport tests:
 * the same object the four doors are mounted on, so what a test drives is the
 * declaration and the application, never a stand-in for either.
 *
 * Built through {@link ScimApp.createWithService}, not {@link ScimApp.create}:
 * the production path also resolves four peers it needs only to build the
 * `ScimService` (`AuthzApi`, `UserApi`, `AuthApi`, `GovernanceApi`) and reads
 * `prisma` off the process, none of which a transport test has a use for.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { ScimService } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { vi } from "vitest";

import { ScimApp } from "../../../app/scim.app.ts";

export class ScimServiceFake extends ScimService {
  readonly verifyToken = vi.fn(async (_input: { token: string }) => ({
    status: "invalid_token" as const,
  }));
  readonly createUser = vi.fn();
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
    webhookSecret?: string | undefined;
    planType?: string;
  } = {},
) {
  const scim = options.scim ?? new ScimServiceFake();
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
    entitlements,
    auditLog,
    webhookSecret: () => ("webhookSecret" in options ? options.webhookSecret : undefined),
  });

  return { app, scim, audited };
}
