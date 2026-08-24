import type { ApiKeyService as ApiKeyCapability } from "@langwatch/api-key-contract";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { ApiKeyDiagnosticsPort } from "../ports/api-key-diagnostics.port";
import { PrismaApiKeyRepository, type PrismaApiKeyDatabase } from "../repositories/prisma/prisma.api-key.repository";
import { ApiKeyService } from "../services/api-key.service";
import {
  LegacyApiKeyGrantService,
  type AuthzBindingIdDeriver,
} from "../services/legacy-api-key-grant.service";
import { ApiKeyTokenAdapter } from "./api-key-token.api-key-token.adapter";

export class PostgresApiKeyAdapter {
  private constructor(private readonly options: {
    database: PrismaApiKeyDatabase;
    pepper: string;
    authz: AuthzService;
    grants: AuthzGrantsService;
    organizations: OrganizationService;
    projects: ProjectService;
    newBindingId: () => string;
    deriveBindingId: AuthzBindingIdDeriver;
    diagnostics: ApiKeyDiagnosticsPort;
  }) {}
  static create(options: PostgresApiKeyAdapter["options"]): PostgresApiKeyAdapter { return new PostgresApiKeyAdapter(options); }
  build(): ApiKeyCapability {
    return ApiKeyService.create({
      repository: PrismaApiKeyRepository.create(this.options.database),
      authz: this.options.authz,
      grants: this.options.grants,
      organizations: this.options.organizations,
      projects: this.options.projects,
      newBindingId: this.options.newBindingId,
      legacyGrants: LegacyApiKeyGrantService.create({
        authz: this.options.authz,
        grants: this.options.grants,
        deriveBindingId: this.options.deriveBindingId,
        diagnostics: this.options.diagnostics,
      }),
      tokens: ApiKeyTokenAdapter.create(this.options.pepper),
    });
  }
}
