import type {
  AuthzGrantsService,
  AuthzService,
} from "@langwatch/authz-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import {
  ApiKeyDiagnosticsPort,
  PostgresApiKeyAdapter,
  type AuthzBindingIdDeriver,
} from "@langwatch/api-key-server";
import type { Logger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { PrismaClient } from "~/generated/prisma/client";

/** Process-owned composition root for the API-key feature. */
export class AppApiKeyRuntime {
  private constructor(
    private readonly options: {
      database: PrismaClient;
      pepper: string;
      authz: AuthzService;
      grants: AuthzGrantsService;
      organizations: OrganizationService;
      projects: ProjectService;
      newBindingId: () => string;
      deriveBindingId: AuthzBindingIdDeriver;
      diagnostics: ApiKeyDiagnosticsPort;
    },
  ) {}

  static create(options: AppApiKeyRuntime["options"]): AppApiKeyRuntime {
    return new AppApiKeyRuntime(options);
  }

  build(): ApiKeyService {
    return PostgresApiKeyAdapter.create(this.options).build();
  }
}

export class AppApiKeyDiagnostics extends ApiKeyDiagnosticsPort {
  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  static create(logger: Pick<Logger, "warn">): AppApiKeyDiagnostics {
    return new AppApiKeyDiagnostics(logger);
  }

  warn(context: Record<string, unknown>, message: string): void {
    this.logger.warn(context, message);
  }
}
