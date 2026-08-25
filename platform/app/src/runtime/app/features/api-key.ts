import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import {
  ApiKeyDiagnosticsPort,
  ApiKeyBindingIdPort,
  PostgresApiKeyAdapter,
  type AuthzBindingIdDeriver,
} from "@langwatch/api-key-server";
import { generate } from "@langwatch/ksuid";
import type { Logger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { PrismaClient } from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";

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
      deriveBindingId: AuthzBindingIdDeriver;
      diagnostics: ApiKeyDiagnosticsPort;
    },
  ) {}

  static create(options: AppApiKeyRuntime["options"]): AppApiKeyRuntime {
    return new AppApiKeyRuntime(options);
  }

  build(): ApiKeyService {
    return PostgresApiKeyAdapter.create({
      ...this.options,
      bindingIds: AppApiKeyBindingIdPort.create(),
    }).build();
  }
}

class AppApiKeyBindingIdPort extends ApiKeyBindingIdPort {
  static create(): AppApiKeyBindingIdPort {
    return new AppApiKeyBindingIdPort();
  }

  private constructor() {
    super();
  }

  generateBindingId(): string {
    return generate(KSUID_RESOURCES.ROLE_BINDING).toString();
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
