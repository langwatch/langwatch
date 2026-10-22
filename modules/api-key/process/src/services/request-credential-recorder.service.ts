import {
  CREDENTIAL_PROJECT_SPAN_ATTRIBUTE,
  CREDENTIAL_TYPE_SPAN_ATTRIBUTE,
  type RequestCredentialType,
} from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";
import { trace } from "@opentelemetry/api";

import { ApiKeyLastUsedService } from "./api-key-last-used.service.ts";

const logger = createLogger("langwatch:api-key:credential");

/**
 * Records which credential authenticated a request, on its span and in a log line, never the
 * token (spec: modules/api-key/specs/request-credential-type.feature).
 */
export class RequestCredentialRecorderService {
  static create(options: {
    projects: Pick<ProjectApi, "markLegacyApiKeyUsed">;
    now?: () => Instant;
  }): RequestCredentialRecorderService {
    return new RequestCredentialRecorderService(
      ApiKeyLastUsedService.create({
        repository: {
          updateLastUsedAt: async ({ id }) => {
            await options.projects.markLegacyApiKeyUsed({ projectId: id });
            logger.info(
              { credentialType: "legacy_project_key", projectId: id },
              "a legacy project key authenticated a request",
            );
          },
        },
        subject: "projectId",
        now: options.now,
      }),
    );
  }

  /** Legacy key uses, keyed by project id: one stamp a minute per project in this process. */
  private constructor(private readonly legacyUses: ApiKeyLastUsedService) {}

  record(input: {
    credentialType: RequestCredentialType;
    projectId?: string;
    organizationId?: string;
  }): void {
    trace.getActiveSpan()?.setAttributes({
      [CREDENTIAL_TYPE_SPAN_ATTRIBUTE]: input.credentialType,
      ...(input.projectId ? { [CREDENTIAL_PROJECT_SPAN_ATTRIBUTE]: input.projectId } : {}),
    });
    logger.debug(input, "request credential resolved");
  }

  /** A legacy key that authenticated a request: recorded, and its project stamped. */
  recordLegacyKeyUse(projectId: string): void {
    this.record({ credentialType: "legacy_project_key", projectId });
    this.legacyUses.markUsed({ id: projectId });
  }
}
