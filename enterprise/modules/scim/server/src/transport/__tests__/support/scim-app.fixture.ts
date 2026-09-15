// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One SCIM application over a fake directory service, for the transport tests:
 * the same object the four doors are mounted on, so what a test drives is the
 * declaration and the application, never a stand-in for either.
 */
import { ScimService } from "@langwatch/enterprise-scim-contract";
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
  const app = ScimApp.create({
    dependencies: {},
    config: void 0,
    resources: { own: () => void 0, ownService: () => void 0 },
    members: {
      scim,
      planProvider: {
        getActivePlan: () => Promise.resolve({ type: options.planType ?? "ENTERPRISE" }),
      },
      webhookSecret: () => ("webhookSecret" in options ? options.webhookSecret : undefined),
      managementAudit: (entry) => {
        audited.push(entry);
      },
    },
  });

  return { app, scim, audited };
}
