import type { ApiKey, ApiKeyScope } from "@langwatch/api-key-contract";

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
  expiresAt: Date | null;
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
  revokedAt?: Date | null;
  lastUsedAt?: Date;
  hashedSecret?: string;
};

/** Private persistence boundary for the API-key aggregate. */
export abstract class ApiKeyRepository {
  abstract create(input: ApiKeyCreateRecord): Promise<StoredApiKey>;
  abstract activate(input: { id: string }): Promise<StoredApiKey>;
  abstract tryFindByLookupId(input: { lookupId: string }): Promise<StoredApiKey | null>;
  abstract tryFindById(input: { id: string }): Promise<StoredApiKey | null>;
  abstract tryFindByIdInOrganization(input: {
    id: string;
    organizationId: string;
  }): Promise<StoredApiKey | null>;
  abstract listForUser(input: { organizationId: string; userId: string }): Promise<StoredApiKey[]>;
  abstract listForOrganization(input: { organizationId: string }): Promise<StoredApiKey[]>;
  abstract update(input: ApiKeyUpdateRecord): Promise<StoredApiKey>;
  abstract revoke(input: { id: string }): Promise<StoredApiKey>;
  abstract updateLastUsedAt(input: { id: string }): Promise<void>;
  abstract upgradeHash(input: { id: string; hashedSecret: string }): Promise<void>;
  abstract tryFindIngestKey(input: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<StoredApiKey | null>;
  abstract findIngestKeysForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<StoredApiKey[]>;
  abstract tryFindLegacyProjectId(input: { token: string }): Promise<string | null>;
  abstract rotateLegacyProjectKey(input: { projectId: string; token: string }): Promise<boolean>;
  /**
   * Revokes every unrevoked key of one reserved name whose expiry has elapsed.
   *
   * Cross-tenant by design: the caller is a fleet-wide sweep, not a request, so
   * there is no organization to scope to. The name is a parameter rather than a
   * constant here because deciding WHICH reserved name may be swept is policy,
   * and policy belongs above persistence.
   */
  abstract revokeExpiredByName(input: { name: string; now: Date }): Promise<number>;
  /** Resolves personal team/project ownership without leaking foreign persistence to the service. */
  abstract tryFindPersonalWorkspaceOwner(input: {
    organizationId: string;
    scopeId: string;
  }): Promise<{ ownerUserId: string | null } | null>;
}
