import {
  ApiKeyScopeViolationError,
  DOCS_SESSION_API_KEY_NAME,
  DocsOriginNotRegisteredError,
  mintDocsSessionKeyInputSchema,
  revokeDocsSessionKeysInputSchema,
  type ApiKeyApi,
  type DocsSessionKeyMinted,
  type DocsSessionRevoked,
  type MintDocsSessionKeyInput,
  type RevokeDocsSessionKeysInput,
} from "@langwatch/api-key-contract";
import { PermissionDeniedError } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import { isRegisteredDocsOrigin } from "@langwatch/config";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, toDate, type Instant } from "@langwatch/time";

import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";
import {
  docsSessionKeyExpiresAt,
  docsSessionKeyPermissions,
} from "../rules/docs-session-key.rules.ts";
import type { ApiKeyLifecycleService } from "./api-key-lifecycle.service.ts";

const logger = createLogger("langwatch:api-key:docs-session");

type DocsSessionKeyServiceOptions = Readonly<{
  apiKeys: Pick<ApiKeyApi, "create">;
  lifecycle: Pick<ApiKeyLifecycleService, "revokeSystemManaged">;
  repository: Pick<ApiKeyRepository, "findById" | "findLiveBySessions">;
  authz: Pick<AuthzApi, "getScope" | "effectivePermissions">;
  organizations: Pick<OrganizationApi, "getSessionPolicy">;
  projects: Pick<ProjectApi, "getWithTeam">;
  /** Every origin a docs session may be handed to, this deployment's own included. */
  docsOrigins: readonly string[];
  now?: () => Instant;
}>;

/**
 * Docs session keys (ADR-185): the member in one project, holding what they hold there, for at
 * most five minutes. Every request is also capped by the member's live grants (ADR-092 §9).
 */
export class DocsSessionKeyService {
  static create(options: DocsSessionKeyServiceOptions): DocsSessionKeyService {
    return new DocsSessionKeyService(options);
  }

  private constructor(private readonly options: DocsSessionKeyServiceOptions) {}

  /** Refuses an operator acting as the member and an unregistered origin before reading. */
  async mint(rawInput: MintDocsSessionKeyInput): Promise<DocsSessionKeyMinted> {
    const input = mintDocsSessionKeyInputSchema.parse(rawInput);
    const { browserSession } = input;
    // Only a browser session mints one; an operator acting as the member never does.
    if (input.impersonatorId || !browserSession) {
      throw new PermissionDeniedError({
        permission: "project:view",
        scope: { type: "project", id: input.projectId },
        denialReason: "no-grant",
      });
    }
    const { docsOrigins } = this.options;
    if (!isRegisteredDocsOrigin({ origin: input.docsOrigin, registered: docsOrigins })) {
      throw new DocsOriginNotRegisteredError();
    }

    const scope = await this.options.authz.getScope({ projectId: input.projectId });
    if (scope.type !== "project") {
      throw new ApiKeyScopeViolationError("A docs session key is bound to an existing project");
    }
    const permissions = docsSessionKeyPermissions(
      await this.options.authz.effectivePermissions({
        principal: { type: "user", id: input.userId },
        scope,
      }),
    );
    if (permissions.length === 0) {
      throw new ApiKeyScopeViolationError("You hold no permission in this project to hand on");
    }
    const [project, policy] = await Promise.all([
      this.options.projects.getWithTeam(input.projectId),
      this.options.organizations.getSessionPolicy({ organizationId: scope.organizationId }),
    ]);
    const nowMs = (this.options.now ?? nowInstant)().epochMilliseconds;
    const expiresAt = docsSessionKeyExpiresAt({
      nowMs,
      sessionExpiresAt: browserSession.expiresAt,
      sessionStartedAt: browserSession.startedAt,
      maxSessionDurationDays: policy.maxSessionDurationDays,
    });

    const { token } = await this.options.apiKeys.create({
      isSystemManaged: true,
      name: DOCS_SESSION_API_KEY_NAME,
      description:
        "Five-minute key the documentation playground holds in memory. Acts as its owner in " +
        "one project and dies with their browser session.",
      userId: input.userId,
      createdByUserId: input.userId,
      organizationId: scope.organizationId,
      permissionMode: "restricted",
      permissions,
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: input.projectId }],
      expiresAt: toDate(expiresAt),
      createdByBrowserSessionId: browserSession.id,
    });

    return {
      token,
      expiresAt: toDate(expiresAt).toISOString(),
      expiresIn: Math.max(1, Math.floor((expiresAt.epochMilliseconds - nowMs) / 1000)),
      project: { id: project.id, name: project.name },
    };
  }

  /** Idempotent, and silent about any key that is not a live docs session key. */
  async revoke(rawInput: RevokeDocsSessionKeysInput): Promise<DocsSessionRevoked> {
    const input = revokeDocsSessionKeysInputSchema.parse(rawInput);
    const keys =
      "apiKeyId" in input
        ? await this.presentedKey(input.apiKeyId)
        : await this.options.repository.findLiveBySessions({
            userId: input.userId,
            name: DOCS_SESSION_API_KEY_NAME,
            browserSessionIds: input.browserSessionIds,
          });
    const cause = "apiKeyId" in input ? "user" : "session";
    const callerUserId = "userId" in input ? input.userId : null;

    for (const key of keys) {
      await this.options.lifecycle.revokeSystemManaged({
        id: key.id,
        organizationId: key.organizationId,
        callerUserId,
        cause,
      });
    }
    if (keys.length > 0) logger.info({ count: keys.length, cause }, "revoked docs session keys");

    return { revoked: true };
  }

  /** The presenting key, only when it is a docs session key: no other key revokes this way. */
  private async presentedKey(
    apiKeyId: string | null,
  ): Promise<{ id: string; organizationId: string }[]> {
    if (apiKeyId === null) return [];
    const key = await this.options.repository.findById({ id: apiKeyId });
    if (!key || key.name !== DOCS_SESSION_API_KEY_NAME || key.isSystemManaged !== true) return [];

    return [{ id: key.id, organizationId: key.organizationId }];
  }
}
