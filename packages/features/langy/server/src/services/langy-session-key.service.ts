import {
  LANGY_SESSION_API_KEY_NAME,
  type ApiKeyService,
} from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { LangyCredentialSession } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import {
  LangySessionKeyPort,
  LangySessionKeyScopeError,
} from "../ports/langy-turn-runtime.port";
import type { LangySessionKeyRepository } from "../repositories/langy-session-key.repository";

const logger = createLogger("langwatch:langy:session-key");
const sessionKeyLifetimeMs = 6 * 60 * 60 * 1000;

export const LANGY_CANDIDATE_PERMISSIONS = [
  "project:view",
  "traces:view",
  "traces:create",
  "traces:update",
  "evaluations:view",
  "evaluations:create",
  "evaluations:update",
  "datasets:view",
  "datasets:create",
  "datasets:update",
  "scenarios:view",
  "scenarios:create",
  "scenarios:update",
  "annotations:view",
  "annotations:create",
  "annotations:update",
  "analytics:view",
  "analytics:create",
  "analytics:update",
  "prompts:view",
  "prompts:create",
  "prompts:update",
  "triggers:view",
  "workflows:view",
  "workflows:create",
  "workflows:update",
  "experiments:view",
] as const;

export type LangySessionKeyRevocation =
  | "revoked"
  | "already_revoked"
  | "not_found"
  | "refused";

export abstract class LangySessionKeyMetricsPort {
  abstract record(input: {
    operation: "minted" | "revoked" | "reaped";
    count?: number;
  }): void;
}

export class LangySessionKeyService extends LangySessionKeyPort {
  private constructor(
    private readonly repository: LangySessionKeyRepository,
    private readonly apiKeys: ApiKeyService,
    private readonly authz: AuthzService,
    private readonly metrics: LangySessionKeyMetricsPort,
  ) {
    super();
  }

  static create(input: {
    repository: LangySessionKeyRepository;
    apiKeys: ApiKeyService;
    authz: AuthzService;
    metrics: LangySessionKeyMetricsPort;
  }): LangySessionKeyService {
    return new LangySessionKeyService(
      input.repository,
      input.apiKeys,
      input.authz,
      input.metrics,
    );
  }

  async mint(input: {
    session: LangyCredentialSession;
    projectId: string;
    organizationId: string;
  }): Promise<{ token: string; apiKeyId: string }> {
    const scope = await this.repository.tryFindProjectScope(input.projectId);
    const permissions =
      scope && scope.organizationId === input.organizationId
        ? await this.authz.effectivePermissions({
            principal: { type: "user", id: input.session.user.id },
            scope: {
              type: "project",
              id: input.projectId,
              teamId: scope.teamId,
              organizationId: scope.organizationId,
            },
          })
        : [];
    const heldPermissions = new Set(permissions);
    const permissionsToGrant = LANGY_CANDIDATE_PERMISSIONS.filter((permission) =>
      heldPermissions.has(permission),
    );
    if (permissionsToGrant.length === 0) {
      throw new LangySessionKeyScopeError(
        "You do not hold any of the permissions Langy needs in this project, so no Langy session key could be created for you.",
      );
    }

    const result = await this.apiKeys.create({
      isSystemManaged: true,
      name: LANGY_SESSION_API_KEY_NAME,
      description: [
        "Ephemeral per-session key for the Langy assistant.",
        "Mirrors your own permissions in this project and auto-expires.",
        "Revoked automatically when it lapses.",
      ].join(" "),
      userId: input.session.user.id,
      createdByUserId: input.session.user.id,
      organizationId: input.organizationId,
      permissionMode: "restricted",
      permissions: permissionsToGrant,
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: input.projectId }],
      expiresAt: new Date(Date.now() + sessionKeyLifetimeMs),
    });
    this.metrics.record({ operation: "minted" });
    return { token: result.token, apiKeyId: result.apiKey.id };
  }

  mintForUser(input: {
    userId: string;
    projectId: string;
    organizationId: string;
  }): Promise<{ token: string; apiKeyId: string }> {
    return this.mint({
      session: { user: { id: input.userId } },
      projectId: input.projectId,
      organizationId: input.organizationId,
    });
  }

  async revoke(input: { apiKeyId: string; projectId: string }): Promise<void> {
    await this.revokeManaged(input);
  }

  async revokeManaged(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<LangySessionKeyRevocation> {
    const key = await this.repository.tryFindById(input);
    if (!key) {
      return "not_found";
    }
    if (key.name !== LANGY_SESSION_API_KEY_NAME) {
      logger.warn(
        { apiKeyId: key.id, name: key.name },
        "refusing to revoke a non-Langy key",
      );
      return "refused";
    }
    if (!key.isScopedToProject) {
      return "not_found";
    }
    if (key.revokedAt) {
      return "already_revoked";
    }

    await this.repository.revoke(key.id, new Date());
    this.metrics.record({ operation: "revoked" });
    return "revoked";
  }

  async reapExpired(now = new Date()): Promise<number> {
    const count = await this.repository.reapExpired(now, LANGY_SESSION_API_KEY_NAME);
    if (count > 0) {
      this.metrics.record({ operation: "reaped", count });
    }
    return count;
  }
}
