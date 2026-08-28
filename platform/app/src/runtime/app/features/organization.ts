import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  PersonalWorkspaceDiagnosticsPort,
  PersonalWorkspaceIdentityPort,
  OrganizationSettingsSecretPort,
  PostgresOrganizationAdapter,
  GroupIdentityPort,
  TeamIdentityPort,
  type PersonalWorkspaceResourceIds,
} from "@langwatch/organization-server";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import type { PrismaClient } from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import { slugify } from "~/utils/slugify";
import { decrypt, encrypt } from "~/utils/encryption";

const logger = createLogger("langwatch:organization");

class AppPersonalWorkspaceIdentityPort extends PersonalWorkspaceIdentityPort {
  create(input: { userId: string; organizationId: string }): PersonalWorkspaceResourceIds {
    const slugPrefix = input.userId.toLowerCase().slice(0, 12);
    return {
      teamId: generate(KSUID_RESOURCES.TEAM).toString(),
      teamSlug: `personal-${slugPrefix}-${nanoid(6).toLowerCase()}`,
      projectId: generate(KSUID_RESOURCES.PROJECT).toString(),
      projectSlug: `personal-${slugPrefix}-${nanoid(6).toLowerCase()}`,
      projectApiKey: `pkey_${nanoid(40)}`,
      ownerBindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    };
  }
}

class AppPersonalWorkspaceDiagnosticsPort extends PersonalWorkspaceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

class AppTeamIdentityPort extends TeamIdentityPort {
  createTeam(input: { name: string }): {
    teamId: string;
    slug: string;
  } {
    const teamId = `team_${nanoid()}`;
    return {
      teamId,
      slug: `${slugify(input.name, { lower: true, strict: true })}-${teamId.substring(0, 11)}`,
    };
  }

  createBindingId(): string {
    return generate(KSUID_RESOURCES.ROLE_BINDING).toString();
  }
}

class AppGroupIdentityPort extends GroupIdentityPort {
  createGroupId(): string {
    return generate(KSUID_RESOURCES.GROUP).toString();
  }

  createBindingId(): string {
    return generate(KSUID_RESOURCES.ROLE_BINDING).toString();
  }

  slugify(name: string): string {
    return slugify(name, { lower: true, strict: true });
  }
}

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
      identities: new AppPersonalWorkspaceIdentityPort(),
      teamIdentities: new AppTeamIdentityPort(),
      groupIdentities: new AppGroupIdentityPort(),
      authz: this.authz,
      grants: this.grants,
      settingsSecrets: new AppOrganizationSettingsSecretPort(),
      diagnostics: new AppPersonalWorkspaceDiagnosticsPort(),
    }).build();
  }
}
