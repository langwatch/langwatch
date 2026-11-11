import {
  LANGY_SESSION_API_KEY_NAME,
  type ApiKeyApi,
  type CreateApiKeyInput,
} from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  langyCandidatePermissions,
  type LangyCredentialSession,
  LangySessionKeyScopeError,
  langyUnattendedPermissions,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, toDate } from "@langwatch/time";

import type { LangyDeleteConfirmationRepository } from "../../../repositories/langy-delete-confirmation.repository.ts";
import type { LangySessionKeyRepository } from "../../../repositories/langy-session-key.repository.ts";

/** Counts minted/revoked/reaped as one series with operation labels so dashboards read
 * minted-minus-revoked without joining (a port because App and worker export differently). */
export interface LangySessionKeyMetrics {
  record(input: { operation: "minted" | "revoked" | "reaped"; count?: number }): void;
}

/**
 * How much of the person's own access a session key may carry: everything Langy may hold for
 * them (`full`, a chat), or only the allowlist a board read needs (`unattended`, a turn
 * nobody is watching and every later turn of its conversation).
 */
type LangySessionKeyCeiling = "full" | "unattended";

type LangySessionKeyMintInput = {
  session: LangyCredentialSession;
  projectId: string;
  organizationId: string;
  /** Absent means `full`. */
  ceiling?: LangySessionKeyCeiling;
  /**
   * The conversation the key works for, and its turn when known. A delete the key asks for
   * shows its confirmation card there; a key minted with none can delete nothing.
   */
  conversation?: { id: string; turnId?: string };
  /**
   * Names the run this key serves: a retry with the same name gets the same key and its pending
   * grant, so a grant that folds slowly is waited on across retries instead of being minted again.
   * A turn that revokes a held key passes the same `holdKey` to `revoke`, so the next mint is a
   * fresh key; a revoke elsewhere is caught by the held key's liveness check instead.
   */
  holdKey?: string;
};

/** Where a minted key's conversation is written, so a delete it asks for can show its card. */
type LangySessionKeyBindings = Pick<LangyDeleteConfirmationRepository, "saveKeyBinding">;

/** Mints and revokes the restricted worker session credential. */
export abstract class LangySessionKey {
  abstract mint(input: LangySessionKeyMintInput): Promise<{ token: string; apiKeyId: string }>;
  abstract revoke(input: {
    apiKeyId: string;
    projectId: string;
    /** The name the key was minted under, when it was held. */
    holdKey?: string;
  }): Promise<void>;
}

const logger = createLogger("langwatch:langy:session-key");
const sessionKeyLifetimeMs = 6 * 60 * 60 * 1000;

/**
 * The permission ceiling a Langy session key may ask for, DERIVED from the policy rather than hand-
 * kept beside it (#7389). A hand-written list cannot say why a line is absent, and three production
 * 403s came from lines nobody remembered to add.
 */
export const LANGY_CANDIDATE_PERMISSIONS = Object.freeze(langyCandidatePermissions());

/** The explicit allowlist an unattended turn's key may ask for: what a board read needs. */
export const LANGY_UNATTENDED_PERMISSIONS = Object.freeze(langyUnattendedPermissions());

const CEILING_PERMISSIONS = {
  full: LANGY_CANDIDATE_PERMISSIONS,
  unattended: LANGY_UNATTENDED_PERMISSIONS,
} as const;

const KEY_DESCRIPTION = {
  full: [
    "Ephemeral per-session key for the Langy assistant.",
    "Mirrors your own permissions in this project and auto-expires.",
    "Revoked automatically when it lapses.",
  ].join(" "),
  unattended: [
    "Ephemeral read-only key for a Langy run started on your behalf.",
    "Holds only what reading a dashboard needs, of what you may view in this project,",
    "and auto-expires. Revoked automatically when it lapses.",
  ].join(" "),
} as const;

type LangySessionKeyRevocation = "revoked" | "already_revoked" | "not_found" | "refused";

export class LangySessionKeyService extends LangySessionKey {
  private readonly repository: LangySessionKeyRepository;
  private readonly apiKeys: ApiKeyApi;
  private readonly authz: Pick<AuthzApi, "effectivePermissions">;
  private readonly metrics: LangySessionKeyMetrics;
  private readonly bindings: LangySessionKeyBindings | undefined;

  private constructor(input: {
    repository: LangySessionKeyRepository;
    apiKeys: ApiKeyApi;
    authz: Pick<AuthzApi, "effectivePermissions">;
    metrics: LangySessionKeyMetrics;
    bindings?: LangySessionKeyBindings;
  }) {
    super();
    this.repository = input.repository;
    this.apiKeys = input.apiKeys;
    this.authz = input.authz;
    this.metrics = input.metrics;
    this.bindings = input.bindings;
  }

  static create(input: {
    repository: LangySessionKeyRepository;
    apiKeys: ApiKeyApi;
    authz: Pick<AuthzApi, "effectivePermissions">;
    metrics: LangySessionKeyMetrics;
    bindings?: LangySessionKeyBindings;
  }): LangySessionKeyService {
    return new LangySessionKeyService(input);
  }

  async mint(input: LangySessionKeyMintInput): Promise<{ token: string; apiKeyId: string }> {
    const ceiling = input.ceiling ?? "full";
    const scope = await this.repository.getProjectScope(input.projectId).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "project_not_found") return null;
      throw error;
    });
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
    const permissionsToGrant = CEILING_PERMISSIONS[ceiling].filter((permission) =>
      heldPermissions.has(permission),
    );
    if (permissionsToGrant.length === 0) {
      throw new LangySessionKeyScopeError(
        "You do not hold any of the permissions Langy needs in this project, so no Langy session key could be created for you.",
      );
    }

    const key = {
      isSystemManaged: true,
      name: LANGY_SESSION_API_KEY_NAME,
      description: KEY_DESCRIPTION[ceiling],
      userId: input.session.user.id,
      createdByUserId: input.session.user.id,
      organizationId: input.organizationId,
      permissionMode: "restricted",
      permissions: permissionsToGrant,
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: input.projectId }],
      expiresAt: toDate(nowInstant().add({ milliseconds: sessionKeyLifetimeMs })),
    } satisfies CreateApiKeyInput;
    const { created, ...result } = input.holdKey
      ? await this.apiKeys.createHeld({ holdKey: input.holdKey, key })
      : await this.apiKeys
          .create(key)
          .then(({ token, apiKey }) => ({ token, apiKeyId: apiKey.id, created: true }));
    // A retry that found its held key minted nothing.
    if (created) this.metrics.record({ operation: "minted" });
    if (input.conversation && this.bindings) {
      await this.bindings.saveKeyBinding({
        apiKeyId: result.apiKeyId,
        binding: {
          projectId: input.projectId,
          conversationId: input.conversation.id,
          ...(input.conversation.turnId ? { turnId: input.conversation.turnId } : {}),
        },
        ttlSeconds: Math.ceil(sessionKeyLifetimeMs / 1000),
      });
    }

    return result;
  }

  mintForUser(input: {
    userId: string;
    projectId: string;
    organizationId: string;
    conversation?: { id: string; turnId?: string };
  }): Promise<{ token: string; apiKeyId: string }> {
    return this.mint({
      session: { user: { id: input.userId } },
      projectId: input.projectId,
      organizationId: input.organizationId,
      ...(input.conversation ? { conversation: input.conversation } : {}),
    });
  }

  async revoke(input: { apiKeyId: string; projectId: string; holdKey?: string }): Promise<void> {
    await this.revokeManaged(input);
    if (!input.holdKey) return;
    // A held key retired while its entry stays would be handed out again to the retry.
    const { organizationId } = await this.repository.getProjectScope(input.projectId);
    await this.apiKeys.releaseHeld({ organizationId, holdKey: input.holdKey });
  }

  async revokeManaged(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<LangySessionKeyRevocation> {
    const key = await this.repository.getById(input).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "api_key_not_found") return null;
      throw error;
    });
    if (!key) {
      return "not_found";
    }

    if (key.name !== LANGY_SESSION_API_KEY_NAME) {
      logger.warn({ apiKeyId: key.id, name: key.name }, "refusing to revoke a non-Langy key");

      return "refused";
    }

    if (!key.isScopedToProject) {
      return "not_found";
    }

    if (key.revokedAt) {
      return "already_revoked";
    }

    await this.repository.revoke(key.id, nowInstant());
    this.metrics.record({ operation: "revoked" });

    return "revoked";
  }
}
