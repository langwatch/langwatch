/**
 * Shared DTO shape for VirtualKey. Consumed by both the tRPC router (camelCase
 * for the UI) and the public Hono REST API (snake_case for SDK / CLI clients).
 *
 * Keeping one source of truth so adding a field in the service layer flows
 * through both surfaces automatically.
 */
import type { VirtualKeyWithChain } from "./virtualKey.repository";

export type VirtualKeyCamelDto = {
  id: string;
  name: string;
  description: string | null;
  environment: "live" | "test";
  status: "active" | "revoked";
  displayPrefix: string;
  principalUserId: string | null;
  providerCredentialIds: string[];
  config: unknown;
  revision: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  fallbackChainLength: number;
};

export type VirtualKeySnakeDto = {
  id: string;
  name: string;
  description: string | null;
  environment: "live" | "test";
  status: "active" | "revoked";
  display_prefix: string;
  principal_user_id: string | null;
  provider_credential_ids: string[];
  config: unknown;
  revision: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  fallback_chain_length: number;
};

/** Internal intermediate shape — neither casing. Both public shapes derive from this. */
type BaseVk = {
  id: string;
  name: string;
  description: string | null;
  environment: "live" | "test";
  status: "active" | "revoked";
  displayPrefix: string;
  principalUserId: string | null;
  providerCredentialIds: string[];
  config: unknown;
  revision: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  fallbackChainLength: number;
};

function baseVk(vk: VirtualKeyWithChain): BaseVk {
  const chain = [...vk.providerCredentials].sort(
    (a, b) => a.priority - b.priority,
  );
  return {
    id: vk.id,
    name: vk.name,
    description: vk.description,
    environment: vk.environment === "LIVE" ? "live" : "test",
    status: vk.status === "ACTIVE" ? "active" : "revoked",
    displayPrefix: vk.displayPrefix,
    principalUserId: vk.principalUserId,
    providerCredentialIds: chain.map((c) => c.providerCredentialId),
    config: vk.config,
    revision: vk.revision.toString(),
    createdAt: vk.createdAt.toISOString(),
    updatedAt: vk.updatedAt.toISOString(),
    lastUsedAt: vk.lastUsedAt?.toISOString() ?? null,
    revokedAt: vk.revokedAt?.toISOString() ?? null,
    fallbackChainLength: chain.length,
  };
}

export function toVirtualKeyCamelDto(
  vk: VirtualKeyWithChain,
): VirtualKeyCamelDto {
  return baseVk(vk);
}

export function toVirtualKeySnakeDto(
  vk: VirtualKeyWithChain,
): VirtualKeySnakeDto {
  const base = baseVk(vk);
  return {
    id: base.id,
    name: base.name,
    description: base.description,
    environment: base.environment,
    status: base.status,
    display_prefix: base.displayPrefix,
    principal_user_id: base.principalUserId,
    provider_credential_ids: base.providerCredentialIds,
    config: base.config,
    revision: base.revision,
    created_at: base.createdAt,
    updated_at: base.updatedAt,
    last_used_at: base.lastUsedAt,
    revoked_at: base.revokedAt,
    fallback_chain_length: base.fallbackChainLength,
  };
}
