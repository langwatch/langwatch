/**
 * Shared DTO shape for VirtualKey. Consumed by both the tRPC router (camelCase
 * for the UI) and the public Hono REST API (snake_case for SDK / CLI clients).
 *
 * Keeping one source of truth so adding a field in the service layer flows
 * through both surfaces automatically.
 */
import type { VirtualKeyWithChain } from "./virtualKey.repository";

/**
 * Enriched provider-credential entry for the fallback chain panel on
 * the VK detail page. The raw `providerCredentialIds: string[]` stays
 * for backwards-compat with existing callers (list page, public REST),
 * but the detail view needs provider type + slot to render the chain
 * with the modelProviderIcons map. See specs/ai-gateway/virtual-keys.feature.
 */
export type VirtualKeyProviderChainEntry = {
  providerCredentialId: string;
  slot: string;
  providerType: string;
};

export type VirtualKeyCamelDto = {
  id: string;
  name: string;
  description: string | null;
  environment: "live" | "test";
  status: "active" | "revoked";
  displayPrefix: string;
  principalUserId: string | null;
  providerCredentialIds: string[];
  providerChain: VirtualKeyProviderChainEntry[];
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
  providerChain: VirtualKeyProviderChainEntry[];
  config: unknown;
  revision: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  fallbackChainLength: number;
};

export type EnrichedChainEntry = {
  providerCredentialId: string;
  slot: string;
  providerType: string;
};

function baseVk(
  vk: VirtualKeyWithChain,
  enriched?: EnrichedChainEntry[],
): BaseVk & { providerChain: VirtualKeyProviderChainEntry[] } {
  const chain = [...vk.providerCredentials].sort(
    (a, b) => a.priority - b.priority,
  );
  const enrichedById = new Map(
    (enriched ?? []).map((e) => [e.providerCredentialId, e]),
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
    providerChain: chain.map((c) => {
      const info = enrichedById.get(c.providerCredentialId);
      return {
        providerCredentialId: c.providerCredentialId,
        slot: info?.slot ?? `#${c.priority + 1}`,
        providerType: info?.providerType ?? "",
      };
    }),
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
  enriched?: EnrichedChainEntry[],
): VirtualKeyCamelDto {
  return baseVk(vk, enriched);
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
