import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  GroupIdentityAdapter,
  OrganizationSettingsSecretPort,
  PersonalWorkspaceDiagnosticsAdapter,
  PersonalWorkspaceIdentityAdapter,
  PostgresOrganizationAdapter,
  TeamIdentityAdapter,
} from "@langwatch/organization-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { decrypt, encrypt } from "~/utils/encryption";

const logger = createLogger("langwatch:organization");

/**
 * The one organization collaborator this process still owns.
 *
 * The identity and diagnostics ports moved into `@langwatch/organization-server`
 * — they mint persisted id and slug formats, which belong to the feature, not
 * to whichever process happens to compose it. This one stays because what it
 * delegates to is process-owned: `~/utils/encryption` resolves the key from
 * THIS application's environment. A second composition root supplies its own
 * cipher over its own configured key, and both write the same at-rest format.
 */
class AppOrganizationSettingsSecretPort extends OrganizationSettingsSecretPort {
  encrypt(value: string): string {
    return encrypt(value);
  }

  decrypt(value: string): string {
    return decrypt(value);
  }
}

export class AppOrganizationRuntime {
  private constructor(
    private readonly database: PrismaClient,
    private readonly authz: AuthzService,
    private readonly grants: AuthzGrantsService,
  ) {}

  static create(options: {
    database: PrismaClient;
    authz: AuthzService;
    grants: AuthzGrantsService;
  }): AppOrganizationRuntime {
    return new AppOrganizationRuntime(options.database, options.authz, options.grants);
  }

  build(): OrganizationService {
    return PostgresOrganizationAdapter.create({
      database: this.database,
      identities: PersonalWorkspaceIdentityAdapter.create(),
      teamIdentities: TeamIdentityAdapter.create(),
      groupIdentities: GroupIdentityAdapter.create(),
      authz: this.authz,
      grants: this.grants,
      settingsSecrets: new AppOrganizationSettingsSecretPort(),
      diagnostics: PersonalWorkspaceDiagnosticsAdapter.create(logger),
    }).build();
  }
}
