import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import {
  ApiKeyBindingIdAdapter,
  ApiKeyDiagnosticsAdapter,
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
      deriveBindingId: AuthzBindingIdDeriver;
      /**
       * The named logger this process wants the feature's warnings under. The
       * port over it is the feature package's own adapter, composed here: a
       * process supplies a logger, never a description of how the feature logs.
       */
      logger: Pick<Logger, "warn">;
    },
  ) {}

  static create(options: AppApiKeyRuntime["options"]): AppApiKeyRuntime {
    return new AppApiKeyRuntime(options);
  }

  build(): ApiKeyService {
    const { logger, ...collaborators } = this.options;

    return PostgresApiKeyAdapter.create({
      ...collaborators,
      bindingIds: ApiKeyBindingIdAdapter.create(),
      diagnostics: ApiKeyDiagnosticsAdapter.create(logger),
    }).build();
  }
}
