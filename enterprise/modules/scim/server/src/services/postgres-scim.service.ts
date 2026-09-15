// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { BrowserSessionApi } from "@langwatch/auth-contract";
import type { GovernanceApi } from "@langwatch/enterprise-governance-contract";
import type { ScimService as ScimServiceContract } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { ScimSyncLifecycle } from "../app/scim.members.ts";
import { PrismaScimRepository } from "../repositories/prisma/prisma.scim.repository.ts";
import { ScimService } from "./scim.service.ts";

export interface PostgresScimAdapterOptions {
  database: PrismaClient;
  writer: AuthzGrantsService;
  users: UserApi;
  auth: BrowserSessionApi;
  governance: GovernanceApi;
  entitlements: Pick<EntitlementApi, "getActivePlan">;
  lifecycle: ScimSyncLifecycle;
  provenOffboarding: boolean;
}

/** Composition-only adapter: one build creates the process-owned SCIM service. */
export class PostgresScimAdapter {
  private constructor(private readonly options: PostgresScimAdapterOptions) {}

  static create(options: PostgresScimAdapterOptions): PostgresScimAdapter {
    return new PostgresScimAdapter(options);
  }

  build(): ScimServiceContract {
    return ScimService.create({
      prisma: PrismaScimRepository.create(this.options.database),
      writer: this.options.writer,
      users: this.options.users,
      auth: this.options.auth,
      governance: this.options.governance,
      entitlements: this.options.entitlements,
      lifecycle: this.options.lifecycle,
      provenOffboarding: this.options.provenOffboarding,
    });
  }
}
