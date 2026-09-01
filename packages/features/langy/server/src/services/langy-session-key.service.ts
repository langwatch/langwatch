import {
  LANGY_SESSION_API_KEY_NAME,
  type ApiKeyService,
} from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import {
  langyCandidatePermissions,
  type LangyCredentialSession,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { LangySessionKeyMetricsPort } from "../ports/langy-session-key-metrics.port";
import {
  LangySessionKeyPort,
  LangySessionKeyScopeError,
} from "../ports/langy-turn-runtime.port";
import type { LangySessionKeyRepository } from "../repositories/langy-session-key.repository";
import { LangySessionKeyReapService } from "./langy-session-key-reap.service";

const logger = createLogger("langwatch:langy:session-key");
const sessionKeyLifetimeMs = 6 * 60 * 60 * 1000;

/**
 * The permission ceiling a Langy session key may ask for, DERIVED from the
 * policy rather than hand-kept beside it (#7389).
 *
 * A hand-written list cannot say why a line is absent, and three production
 * 403s came from lines nobody remembered to add. `langyCandidatePermissions()`
 * walks the permission registry and keeps every grain the policy calls
 * `granted`, so the list can no longer fall behind the vocabulary.
 *
 * This is a CEILING, not a grant: `mint` intersects it with the permissions
 * the requesting human actually holds, so widening it can never give anyone
 * access they did not already have by hand.
 */
export const LANGY_CANDIDATE_PERMISSIONS = Object.freeze(
  langyCandidatePermissions(),
);

export type LangySessionKeyRevocation =
  | "revoked"
  | "already_revoked"
  | "not_found"
  | "refused";

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

  /**
   * The fleet-wide sweep, delegated rather than repeated.
   *
   * Two graphs run this reap — the App's registered pipeline and the packaged
   * worker's — and only one of them reaches it through this service. Composing
   * the sweep here means both run the same reserved-name gate and the same
   * single clock read, so the two can never come to disagree about which keys
   * are in scope.
   */
  reapExpired(now = new Date()): Promise<number> {
    return LangySessionKeyReapService.create({
      repository: this.repository,
      metrics: this.metrics,
      now: () => now,
    }).reap();
  }
}
