/**
 * Shared DTO shape for VirtualKey. Consumed by both the tRPC router
 * (camelCase for the UI) and the public Hono REST API (snake_case for
 * SDK / CLI clients).
 *
 * Post-collapse: the legacy `providerCredentialIds` + `providerChain`
 * fields are gone from the wire. The VK's eligible-provider set is
 * derived from the scope graph + optional RoutingPolicy at request time
 * (see `scopeResolver.ts`); the DTO exposes the scope set + the
 * `routingPolicyId` so callers can render the binding-equivalent view.
 *
 * The token format is `vk-lw-<ulid>` with no live/test discriminator;
 * the gateway never branches on environment, so there is no env field.
 */
import type { VirtualKeyWithScopes } from "./virtualKey.repository";

export type VirtualKeyScopeEntry = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

export type VirtualKeyCamelDto = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: "active" | "revoked";
  purpose: "user" | "langy";
  displayPrefix: string;
  principalUserId: string | null;
  principalUser: { name: string | null; email: string | null } | null;
  scopes: VirtualKeyScopeEntry[];
  routingPolicyId: string | null;
  config: unknown;
  revision: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type VirtualKeySnakeDto = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: "active" | "revoked";
  purpose: "user" | "langy";
  display_prefix: string;
  principal_user_id: string | null;
  scopes: Array<{ scope_type: string; scope_id: string }>;
  routing_policy_id: string | null;
  config: unknown;
  revision: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type BaseVk = Omit<VirtualKeyCamelDto, never>;

function baseVk(vk: VirtualKeyWithScopes): BaseVk {
  return {
    id: vk.id,
    organizationId: vk.organizationId,
    name: vk.name,
    description: vk.description,
    status: vk.status === "ACTIVE" ? "active" : "revoked",
    purpose: vk.purpose === "LANGY" ? "langy" : "user",
    displayPrefix: vk.displayPrefix,
    principalUserId: vk.principalUserId,
    principalUser: vk.principalUser
      ? { name: vk.principalUser.name, email: vk.principalUser.email }
      : null,
    scopes: vk.scopes.map((s) => ({
      scopeType: s.scopeType,
      scopeId: s.scopeId,
    })),
    routingPolicyId: vk.routingPolicyId,
    config: vk.config,
    revision: vk.revision.toString(),
    createdAt: vk.createdAt.toISOString(),
    updatedAt: vk.updatedAt.toISOString(),
    lastUsedAt: vk.lastUsedAt?.toISOString() ?? null,
    revokedAt: vk.revokedAt?.toISOString() ?? null,
  };
}

export function toVirtualKeyCamelDto(
  vk: VirtualKeyWithScopes,
): VirtualKeyCamelDto {
  return baseVk(vk);
}

export function toVirtualKeySnakeDto(
  vk: VirtualKeyWithScopes,
): VirtualKeySnakeDto {
  const base = baseVk(vk);
  return {
    id: base.id,
    organization_id: base.organizationId,
    name: base.name,
    description: base.description,
    status: base.status,
    purpose: base.purpose,
    display_prefix: base.displayPrefix,
    principal_user_id: base.principalUserId,
    scopes: base.scopes.map((s) => ({
      scope_type: s.scopeType,
      scope_id: s.scopeId,
    })),
    routing_policy_id: base.routingPolicyId,
    config: base.config,
    revision: base.revision,
    created_at: base.createdAt,
    updated_at: base.updatedAt,
    last_used_at: base.lastUsedAt,
    revoked_at: base.revokedAt,
  };
}
