/**
 * The credential chain both public Langy REST families share. ORDER IS THE CONTRACT, and it is the
 * same on the turn surface and the UI-action surface: credential (401), per-project rollout (dark
 * 404), then the API-key ceiling (403), then the identity bridge.
 */
import type { ApiKeyService, ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { FeatureFlagKey, FeatureFlagService } from "@langwatch/feature-flag-contract";
import {
  LangyApiCredentialInvalidError,
  LangyApiCredentialMissingError,
  LangyApiIdentityDeniedError,
  type LangyCredentialSession,
} from "@langwatch/langy-contract";

import {
  LangyActorSessionService,
  type LangyActorUserReader,
} from "#services/langy-actor-session.service";
import { LangyKeyIdentityService } from "#services/langy-key-identity.service";

/**
 * How this process reads a project credential off a request. A port because credential precedence
 * (Basic, then Bearer, then `X-Auth-Token`) is the deployment's published contract across every
 * REST family, and a second reading of it here is how the two would drift.
 */
export type LangyRestCredentialReader = (
  request: Request,
) => Readonly<{ token: string; projectId: string | null }> | null;

/**
 * Enforces one permission as the resolved key's ceiling, throwing the deployment's own refusal.
 */
export type LangyRestCeilingPort = (input: {
  resolved: ResolvedApiKeyToken;
  permission: AuthzPermission;
}) => Promise<void>;

/** What both public Langy families resolve a caller through. */
export type LangyRestCredentialPorts = Readonly<{
  /** Reads the credential off the request. */
  readCredential: LangyRestCredentialReader;
  /** The directory the credential is resolved and stamped through. */
  apiKeys: () => ApiKeyService;
  /** Enforces one permission as the key's ceiling. */
  enforceCeiling: LangyRestCeilingPort;
  /** This deployment's flag store, for the per-project rollout gate. */
  featureFlags: () => FeatureFlagService;
  /** The user directory a key's owner is read from. */
  actors: () => LangyActorUserReader;
}>;

/** A caller who got through, or the dark surface that answers nothing. */
export type LangyRestCaller =
  | Readonly<{ dark: true }>
  | Readonly<{
      dark: false;
      resolved: ResolvedApiKeyToken;
      projectId: string;
      userId: string;
      markUsed: () => void;
    }>;

/**
 * Authenticate, open the flag, and bridge to the owning user. Throws on every refusal EXCEPT the
 * dark surface.
 */
export async function resolveLangyRestCaller(input: {
  request: Request;
  ports: LangyRestCredentialPorts;
  /** The rollout flag this surface is gated on. */
  flag: FeatureFlagKey;
}): Promise<LangyRestCaller> {
  const credentials = input.ports.readCredential(input.request);
  if (!credentials) throw new LangyApiCredentialMissingError();

  const apiKeys = input.ports.apiKeys();
  const resolved = await apiKeys.tryResolveToken({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) throw new LangyApiCredentialInvalidError();

  const surfaceOpen = await input.ports.featureFlags().isEnabled(input.flag, {
    kind: "project",
    projectId: resolved.project.id,
    organizationId: resolved.project.organizationId,
  });
  if (!surfaceOpen) return { dark: true };

  const identity = await LangyKeyIdentityService.create({
    featureFlags: input.ports.featureFlags(),
  }).resolve({ resolved });
  if (!identity.ok) {
    throw new LangyApiIdentityDeniedError(
      identity.reason === "unowned" ? "langy_api_key_unowned" : "langy_api_key_no_langy_access",
      identity.message,
    );
  }

  return {
    dark: false,
    resolved,
    projectId: resolved.project.id,
    userId: identity.userId,
    markUsed: () => {
      if (resolved.type === "apiKey") {
        apiKeys.markUsed({ id: resolved.apiKeyId });
      }
    },
  };
}

/** The person a turn is filed under, or the refusal that no such person exists. */
export async function resolveLangyRestActor(input: {
  ports: LangyRestCredentialPorts;
  userId: string;
}): Promise<LangyCredentialSession> {
  const actor = await LangyActorSessionService.create({
    users: input.ports.actors(),
  }).resolve({ userId: input.userId });
  if (!actor.ok) {
    throw new LangyApiIdentityDeniedError("langy_api_actor_missing", actor.message);
  }
  return actor.session;
}
