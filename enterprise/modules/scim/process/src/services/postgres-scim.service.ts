import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import type { ScimService as ScimServiceContract } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { UserApi } from "@langwatch/user-contract";

import type { ScimSyncLifecycle } from "../app/scim.members.ts";
import type { ScimRepository } from "../repositories/scim.repository.ts";
import type { ScimOrganizationAdministration } from "./scim-deprovision.service.ts";
import { ScimService } from "./scim.service.ts";

/** Composition-only service factory: one build creates the process-owned SCIM service. */
export class PostgresScimService {
  private constructor() {}

  static create(options: {
    repository: ScimRepository;
    writer: AuthzGrantsService;
    users: UserApi;
    governance: GovernanceRestApi;
    organization: ScimOrganizationAdministration;
    entitlements: Pick<EntitlementApi, "getActivePlan">;
    lifecycle: ScimSyncLifecycle;
    provenOffboarding: boolean;
    tokenPepper: string | undefined;
  }): ScimServiceContract {
    return ScimService.create({
      prisma: options.repository,
      writer: options.writer,
      users: options.users,
      governance: options.governance,
      organization: options.organization,
      entitlements: options.entitlements,
      lifecycle: options.lifecycle,
      provenOffboarding: options.provenOffboarding,
      tokenPepper: options.tokenPepper,
    });
  }
}
