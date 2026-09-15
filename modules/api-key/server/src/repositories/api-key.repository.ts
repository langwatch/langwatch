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
  /**
   * Revokes every unrevoked key of one reserved name whose expiry has elapsed.
   *
   * Cross-tenant by design: the caller is a fleet-wide sweep, not a request, so
   * there is no organization to scope to. The name is a parameter rather than a
   * constant here because deciding WHICH reserved name may be swept is policy,
   * and policy belongs above persistence.
   */
  abstract revokeExpiredByName(input: { name: string; now: Instant }): Promise<number>;
  /**
   * The live keys minted under one key, inside its organization.
   *
   * Bounded by `organizationId` so the cascade goes through the ordinary
   * tenancy guard rather than a cross-tenant hatch: a cascade always knows
   * whose organization it is retiring keys in.
   */
  abstract findLiveChildren(input: {
    parentApiKeyId: string;
    organizationId: string;
  }): Promise<Array<{ id: string }>>;
  /**
   * Whether one key is still usable, by id, without its bindings.
   *
   * The auth path asks this about a key's parent on every request that
   * presents a session-minted key, so it reads only the two columns that
   * decide it.
   */
  abstract findLivenessById(input: {
    id: string;
  }): Promise<{ revokedAt: Instant | null; expiresAt: Instant | null } | null>;
  /**
   * Every unrevoked CLI login key (name carries {@link CLI_LOGIN_KEY_NAME_PREFIX})
   * whose session has run out.
   *
   * Cross-tenant by design, like {@link revokeExpiredByName}: the caller is
   * the hourly sweep, not a request, and a session the CLI stops refreshing
   * leaves no other trace to scope a read to. `expiresAt: { not: null }` is
   * carried explicitly so a login key minted before device metadata (and
   * therefore no expiry) is never swept.
   */
  abstract findElapsedLoginKeys(input: {
    now: Instant;
  }): Promise<Array<{ id: string; userId: string | null; organizationId: string }>>;
  /**
   * Moves a live CLI login key's expiry with its session. A successful
   * refresh calls this with the value `loginKeyExpiresAt` gives for the new
   * refresh window, so a session nothing keeps refreshing is still retired
   * by the hourly sweep rather than sliding forward forever.
   *
   * Scoped by name prefix as well as id/organization/user so this can never
   * touch a key that is not a CLI login key. A key already revoked is left
   * alone (`revokedAt: null`), so a refresh racing a revoke never brings a
   * dead key back into the sweep's live set.
   */
  abstract extendLoginKeyExpiry(input: {
    id: string;
    organizationId: string;
    userId: string;
    expiresAt: Instant;
  }): Promise<void>;
}
