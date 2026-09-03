// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { AuthService } from "@langwatch/auth-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { ScimService as ScimServiceContract } from "@langwatch/enterprise-scim-contract";
import type { EntitlementService } from "@langwatch/entitlement-contract";
import type { UserService } from "@langwatch/user-contract";
import type { ScimSyncLifecyclePort } from "../ports/scim-sync-lifecycle.port";
import { PrismaScimRepository } from "../repositories/prisma/scim.repository";
import { ScimService } from "../services/scim.service";

export interface PostgresScimAdapterOptions {
  database: object;
  writer: AuthzGrantsService;
  users: UserService;
  auth: AuthService;
  governance: GovernanceService;
  entitlements: EntitlementService;
  lifecycle: ScimSyncLifecyclePort;
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
