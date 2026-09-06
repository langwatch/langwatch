import type { ApiKeyService } from "@langwatch/api-key-contract";
import {
  ApiKeyBindingIdAdapter,
  ApiKeyDiagnosticsAdapter,
  PostgresApiKeyAdapter,
} from "@langwatch/api-key-server";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import { EventingAuthzGrantAdapter } from "@langwatch/authz-server";
import { createLogger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  GroupIdentityAdapter,
  PersonalWorkspaceDiagnosticsAdapter,
  PersonalWorkspaceIdentityAdapter,
  PostgresOrganizationAdapter,
  TeamIdentityAdapter,
} from "@langwatch/organization-server";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { ProjectService } from "@langwatch/project-contract";
import {
  PostgresProjectAdapter,
  ProjectCredentialsAdapter,
  ProjectDiagnosticsPort,
  type ProjectKeyMapPort,
} from "@langwatch/project-server";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import { ApiOrganizationSettingsSecretAdapter } from "./api-organization-settings-secret.adapter.ts";

/** Reports the composition decision a missing collaborator would otherwise hide. */
export abstract class ApiTenancyAbsenceReportPort {
  abstract absent(reason: "no-database" | "no-authz" | "no-pepper"): void;
}

export type ApiTenancyCompositionOptions = {
  database: PrismaConnection;
  /** The two AuthZ services as one graph; see `ApiProductionComposition.authz`. */
  authz: { permissions: AuthzService; grants: AuthzGrantsService };
  /** The same cipher the stored-secret family runs under. */
  encryption: SecretEncryptionPort;
  /** The HMAC key an API key's stored hash is derived under, verbatim. */
  pepper: string;
  /**
   * The LangWatchQL key map, where this process opened a ClickHouse. A project's key has
   * to reach the table the approved views read, or a governed query against a project
   * created after the last backfill resolves nothing.
   */
  keyMap?: ProjectKeyMapPort | undefined;
};

/**
 * The organization, project and API-key services this process composes for itself.
 */
export class ApiTenancyComposition {
  /**
   * Composes the three services only when this process has everything they need to answer
   * correctly.
   */
  static tryCompose(
    options: Omit<ApiTenancyCompositionOptions, "database" | "authz" | "encryption" | "pepper"> & {
      database: PrismaConnection | undefined;
      authz: { permissions: AuthzService; grants: AuthzGrantsService } | undefined;
      encryption: SecretEncryptionPort | undefined;
      pepper: string | undefined;
      report?: ApiTenancyAbsenceReportPort;
    },
  ): ApiTenancyComposition | undefined {
    if (!options.database) {
      options.report?.absent("no-database");
      return undefined;
    }
    if (!options.authz) {
      options.report?.absent("no-authz");
      return undefined;
    }
    const pepper = options.pepper?.trim();
    if (!options.encryption || !pepper) {
      options.report?.absent("no-pepper");
      return undefined;
    }
    return ApiTenancyComposition.compose({
      database: options.database,
      authz: options.authz,
      encryption: options.encryption,
      pepper,
    });
  }

  static compose(options: ApiTenancyCompositionOptions): ApiTenancyComposition {
    const database = options.database.client;
    const organizations = PostgresOrganizationAdapter.create({
      database,
      identities: PersonalWorkspaceIdentityAdapter.create(),
      teamIdentities: TeamIdentityAdapter.create(),
      groupIdentities: GroupIdentityAdapter.create(),
      authz: options.authz.permissions,
      grants: options.authz.grants,
      settingsSecrets: ApiOrganizationSettingsSecretAdapter.create({
        encryption: options.encryption,
      }),
      diagnostics: PersonalWorkspaceDiagnosticsAdapter.create(
        createLogger("langwatch:organization"),
      ),
    }).build();

    // `storedObjects` is deliberately absent, and the adapter declares it optional because
    // absence is a supported shape rather than a gap this root is papering over: a project
    // deleted here leaves the stored-object cleanup to the tier that owns it. `keyMap` is
    // not in that category — it is this process's own ClickHouse, and it is supplied
    // wherever one was opened.
    const projects = PostgresProjectAdapter.create({
      database,
      credentials: ProjectCredentialsAdapter.create(),
      organizations,
      ...(options.keyMap ? { keyMap: options.keyMap } : {}),
      diagnostics: LoggedApiProjectDiagnostics.create(),
    }).build();

    const apiKeys = PostgresApiKeyAdapter.create({
      database,
      pepper: options.pepper,
      authz: options.authz.permissions,
      grants: options.authz.grants,
      organizations,
      projects,
      bindingIds: ApiKeyBindingIdAdapter.create(),
      // The import-shaped identity: a compatibility grant minted for a
      // credential that predates the ledger has to derive the same id every
      // time it is re-minted, or a re-run writes a second fact for one access.
      deriveBindingId: EventingAuthzGrantAdapter.deriveGrantId,
      diagnostics: ApiKeyDiagnosticsAdapter.create(createLogger("langwatch:api-key")),
    }).build();

    return new ApiTenancyComposition(organizations, projects, apiKeys);
  }

  private constructor(
    readonly organizations: OrganizationService,
    readonly projects: ProjectService,
    readonly apiKeys: ApiKeyService,
  ) {}
}

/**
 * The project service's diagnostics, on this process's own structured logger. `capture`
 * exists because a project operation can fail in a way nothing above it can act on, and
 * the platform app answers that by handing the error to Sentry.
 */
class LoggedApiProjectDiagnostics extends ProjectDiagnosticsPort {
  static create(): LoggedApiProjectDiagnostics {
    return new LoggedApiProjectDiagnostics(createLogger("langwatch:project"));
  }

  private constructor(private readonly logger: ReturnType<typeof createLogger>) {
    super();
  }

  error(context: Record<string, unknown>, message: string): void {
    this.logger.error(context, message);
  }

  capture(error: Error, context: Record<string, unknown>): void {
    this.logger.error({ ...context, error }, "Project operation failed");
  }
}
