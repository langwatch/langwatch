import type { ApiKey, ApiKeyRevocationCause, ApiKeyScope } from "@langwatch/api-key-contract";
import type { Instant } from "@langwatch/time";

export type StoredApiKey = ApiKey & { hashedSecret: string };
export type ApiKeyCreateRecord = {
  name: string;
  description: string | null;
  lookupId: string;
  hashedSecret: string;
  permissionMode: string;
  userId: string | null;
  createdByUserId: string | null;
  createdByDeviceLabel?: string | null;
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
  abstract create(input: ApiKeyCreateRecord): Promise<StoredApiKey>;
  abstract activate(input: { id: string }): Promise<StoredApiKey>;
  abstract findByLookupId(input: { lookupId: string }): Promise<StoredApiKey | null>;
  abstract findById(input: { id: string }): Promise<StoredApiKey | null>;
  abstract findByIdInOrganization(input: {
    id: string;
    organizationId: string;
  }): Promise<StoredApiKey | null>;
  abstract listForUser(input: { organizationId: string; userId: string }): Promise<StoredApiKey[]>;
  abstract listForOrganization(input: { organizationId: string }): Promise<StoredApiKey[]>;
  abstract update(input: ApiKeyUpdateRecord): Promise<StoredApiKey>;
  /**
   * Marks a key revoked, recording why, and never overwrites a cause already
   * on the row. The fence on `revokedAt` makes the cause the FIRST
   * revocation's: a person revoking a key and the personal ingest-key cap
   * retiring it can both read a live row, and a `"cap"` written over a
   * `"user"` would let the CLI re-mint a key a person meant to kill.
   */
  abstract revoke(input: { id: string; cause: ApiKeyRevocationCause }): Promise<StoredApiKey>;
  abstract updateLastUsedAt(input: { id: string }): Promise<void>;
  abstract upgradeHash(input: { id: string; hashedSecret: string }): Promise<void>;
  abstract findIngestKey(input: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<StoredApiKey | null>;
  abstract findIngestKeysForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<StoredApiKey[]>;
  abstract findLegacyProjectId(input: { token: string }): Promise<string | null>;
  abstract rotateLegacyProjectKey(input: { projectId: string; token: string }): Promise<boolean>;
  /**
   * Revokes every unrevoked key of one reserved name whose expiry has elapsed.
   *
   * Cross-tenant by design: the caller is a fleet-wide sweep, not a request, so
   * there is no organization to scope to. The name is a parameter rather than a
   * constant here because deciding WHICH reserved name may be swept is policy,
   * and policy belongs above persistence.
   */
  abstract revokeExpiredByName(input: { name: string; now: Instant }): Promise<number>;
  /** Resolves personal team/project ownership without leaking foreign persistence upward. */
  abstract findPersonalWorkspaceOwner(input: {
    organizationId: string;
    scopeId: string;
  }): Promise<{ ownerUserId: string | null } | null>;
}
