import type {
  IngestionKeyMintCommand,
  IssuedIngestionKey,
} from "@langwatch/enterprise-governance-contract";

export type StoredIngestionKey = {
  id: string;
  lookupId: string;
  ingestSourceType: string | null;
  ingestionTemplateId: string | null;
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
}

export abstract class IngestionKeyIssuerPort {
  abstract create(input: {
    name: string;
    userId: string | null;
    createdByUserId: string;
    organizationId: string;
    permissionMode: "restricted";
    permissions: readonly ["traces:create"];
    bindings: readonly [
      { role: "CUSTOM"; scopeType: "PROJECT"; scopeId: string },
    ];
    ingestSourceType: string;
    ingestionTemplateId: string | null;
    createdByDeviceLabel: string | null;
  }): Promise<{ token: string; apiKey: { id: string } }>;

  abstract revoke(input: {
    id: string;
    callerUserId: string;
    callerIsAdmin: true;
    organizationId: string;
    awaitProjection: false;
  }): Promise<void>;
}

export abstract class IngestionKeyCapability {
  abstract ensureForProject(
    input: IngestionKeyMintCommand,
  ): Promise<IssuedIngestionKey>;
}
