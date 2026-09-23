import type { ApiKey, ApiKeyRevocationCause, ApiKeyScope } from "@langwatch/api-key-contract";
import type { Instant } from "@langwatch/time";

export type StoredApiKey = ApiKey & { hashedSecret: string };
/** A key as its own row holds it: its grants are authz's, joined by the service. */
export type ApiKeyRow = Omit<StoredApiKey, "roleBindings">;
export type ApiKeyCreateRecord = {
  name: string;
  description: string | null;
  lookupId: string;
  hashedSecret: string;
  permissionMode: string;
  userId: string | null;
  createdByUserId: string | null;
  createdByDeviceLabel?: string | null;
  /**
   * The CLI login key of the device session minting this key, so revoking
   * that session revokes this key with it. Undefined/null for every key
   * minted outside a CLI session.
   */
  parentApiKeyId?: string | null;
  organizationId: string;
  expiresAt: Instant | null;
  ingestSourceType: string | null;
  ingestionTemplateId: string | null;
  startsDisabled: boolean;
  roleBindings: ApiKeyScope[];
};
export type ApiKeyUpdateRecord = {
  id: string;
  name?: string;
  description?: string | null;
  permissionMode?: string;
  roleBindings?: ApiKeyScope[];
  revokedAt?: Instant | null;
  lastUsedAt?: Instant;
  hashedSecret?: string;
};

/** Private persistence boundary for the API-key aggregate. */
export abstract class ApiKeyRepository {
  abstract create(input: ApiKeyCreateRecord): Promise<ApiKeyRow>;
  abstract activate(input: { id: string }): Promise<ApiKeyRow>;
  abstract findByLookupId(input: { lookupId: string }): Promise<ApiKeyRow | null>;
  abstract findById(input: { id: string }): Promise<ApiKeyRow | null>;
  abstract findByIdInOrganization(input: {
    id: string;
    organizationId: string;
  }): Promise<ApiKeyRow | null>;
  abstract listForUser(input: { organizationId: string; userId: string }): Promise<ApiKeyRow[]>;
  abstract listForOrganization(input: { organizationId: string }): Promise<ApiKeyRow[]>;
  abstract update(input: ApiKeyUpdateRecord): Promise<ApiKeyRow>;
  /**
   * Marks a key revoked, keeping the FIRST cause ever recorded: the fence
   * on `revokedAt` stops a `"cap"` retirement from overwriting a `"user"`
   * revoke that already landed.
   */
  abstract revoke(input: { id: string; cause: ApiKeyRevocationCause }): Promise<ApiKeyRow>;
  abstract updateLastUsedAt(input: { id: string }): Promise<void>;
  abstract upgradeHash(input: { id: string; hashedSecret: string }): Promise<void>;
  /** The newest live ingest key of this source among keys the caller named. */
  abstract findIngestKey(input: {
    organizationId: string;
    apiKeyIds: readonly string[];
    sourceType: string;
  }): Promise<ApiKeyRow | null>;
  /** The live ingest keys among keys the caller named, newest first. */
  abstract findIngestKeys(input: {
    organizationId: string;
    apiKeyIds: readonly string[];
  }): Promise<ApiKeyRow[]>;
  /**
   * Revokes every unrevoked key of one reserved name past expiry.
   * Cross-tenant by design (a fleet-wide sweep, not a request); the name is
   * a parameter because choosing which reserved name to sweep is policy.
   */
  abstract revokeExpiredByName(input: { name: string; now: Instant }): Promise<number>;
  /**
   * The live keys minted under one key, inside its organization. Bounded
   * by `organizationId` so the cascade goes through the ordinary tenancy
   * guard rather than a cross-tenant hatch.
   */
  abstract findLiveChildren(input: {
    parentApiKeyId: string;
    organizationId: string;
  }): Promise<{ id: string }[]>;
  /**
   * Whether one key is still usable, by id, without its bindings. The auth
   * path asks this about a key's parent on every request presenting a
   * session-minted key, so it reads only the two columns that decide it.
   */
  abstract findLivenessById(input: {
    id: string;
  }): Promise<{ revokedAt: Instant | null; expiresAt: Instant | null } | null>;
  /**
   * Every unrevoked CLI login key past its session. Cross-tenant, like
   * {@link revokeExpiredByName}: the caller is the hourly sweep, not a
   * request. `expiresAt: { not: null }` excludes a key minted before device metadata.
   */
  abstract findElapsedLoginKeys(input: {
    now: Instant;
  }): Promise<{ id: string; userId: string | null; organizationId: string }[]>;
  /**
   * Moves a live CLI login key's expiry with its session, so an inactive
   * session is still retired by the hourly sweep. A key already revoked is
   * left alone, so a refresh racing a revoke can't resurrect it.
   */
  abstract extendLoginKeyExpiry(input: {
    id: string;
    organizationId: string;
    userId: string;
    expiresAt: Instant;
  }): Promise<void>;
}
