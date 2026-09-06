import type { ApiKeyRevocationCause } from "@langwatch/api-key-contract";
import type {
  IngestionKeyMintCommand,
  IssuedIngestionKey,
} from "@langwatch/enterprise-governance-contract";

export type StoredIngestionKey = {
  id: string;
  lookupId: string;
  ingestSourceType: string | null;
  ingestionTemplateId: string | null;
  /** When the key last authenticated; nothing when it never has. */
  lastUsedAt?: Date | null;
  createdAt?: Date;
};

/** One key as `describePersonalKey` reads it, ownership included. */
export type StoredIngestionKeyOwnership = StoredIngestionKey & {
  organizationId: string;
  userId: string | null;
  revokedAt: Date | null;
  revocationCause: string | null;
};

export abstract class IngestionKeyRepository {
  abstract tryFindIngestKey(input: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<StoredIngestionKey | null>;

  abstract findIngestKeysForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<StoredIngestionKey[]>;

  /** One key by the lookup id embedded in its token, whether live or not. */
  abstract tryFindByLookupId(input: {
    lookupId: string;
  }): Promise<StoredIngestionKeyOwnership | null>;
}

export abstract class IngestionKeyIssuerPort {
  abstract create(input: {
    name: string;
    userId: string | null;
    createdByUserId: string;
    organizationId: string;
    permissionMode: "restricted";
    permissions: readonly ["traces:create"];
    bindings: readonly [{ role: "CUSTOM"; scopeType: "PROJECT"; scopeId: string }];
    ingestSourceType: string;
    ingestionTemplateId: string | null;
    createdByDeviceLabel: string | null;
  }): Promise<{ token: string; apiKey: { id: string } }>;

  abstract revoke(input: {
    id: string;
    callerUserId: string;
    callerIsAdmin: boolean;
    organizationId: string;
    awaitProjection: false;
    /** Why the key dies, so the CLI can tell a re-mintable key from a dead one. */
    cause?: ApiKeyRevocationCause;
  }): Promise<void>;
}

export abstract class IngestionKeyCapability {
  abstract ensureForProject(input: IngestionKeyMintCommand): Promise<IssuedIngestionKey>;
}
