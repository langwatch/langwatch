// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ApiKeyRevocationCause, ApiKeyService } from "@langwatch/api-key-contract";
import {
  IngestionKeyIssuerPort,
  IngestionKeyRepository,
  type StoredIngestionKey,
  type StoredIngestionKeyOwnership,
} from "@langwatch/enterprise-governance-server";
import { fromDate } from "@langwatch/time";

type IngestionKeyCreateInput = {
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
};

type IngestionKeyRevokeInput = {
  id: string;
  callerUserId: string;
  callerIsAdmin: boolean;
  organizationId: string;
  awaitProjection: false;
  cause?: ApiKeyRevocationCause;
};

/** One key row as the API-key service answers it. */
type ApiKeyIngestionRow = Awaited<ReturnType<ApiKeyService["listIngestionKeysForProject"]>>[number];

/** One key row's stamps, on the one clock the governance seam reads. */
function storedIngestionKeyOf(key: ApiKeyIngestionRow): StoredIngestionKey {
  return {
    id: key.id,
    lookupId: key.lookupId,
    ingestSourceType: key.ingestSourceType,
    ingestionTemplateId: key.ingestionTemplateId,
    lastUsedAt: key.lastUsedAt === null ? null : fromDate(key.lastUsedAt),
    createdAt: fromDate(key.createdAt),
  };
}

export class AppIngestionKeyRepository extends IngestionKeyRepository {
  private constructor(private readonly apiKeys: ApiKeyService) {
    super();
  }

  static create(apiKeys: ApiKeyService): AppIngestionKeyRepository {
    return new AppIngestionKeyRepository(apiKeys);
  }

  tryFindIngestKey(input: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<StoredIngestionKey | null> {
    return this.apiKeys
      .tryGetIngestionKey(input)
      .then((key) => (key === null ? null : storedIngestionKeyOf(key)));
  }

  findIngestKeysForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<StoredIngestionKey[]> {
    return this.apiKeys
      .listIngestionKeysForProject(input)
      .then((keys) => keys.map(storedIngestionKeyOf));
  }

  async tryFindByLookupId(input: {
    lookupId: string;
  }): Promise<StoredIngestionKeyOwnership | null> {
    const key = await this.apiKeys.tryGetByLookupId(input);
    if (!key) return null;

    return {
      ...storedIngestionKeyOf(key),
      organizationId: key.organizationId,
      userId: key.userId,
      revokedAt: key.revokedAt === null ? null : fromDate(key.revokedAt),
      revocationCause: key.revocationCause ?? null,
    };
  }
}

export class AppIngestionKeyIssuerPort extends IngestionKeyIssuerPort {
  private constructor(private readonly apiKeys: ApiKeyService) {
    super();
  }

  static create(apiKeys: ApiKeyService): AppIngestionKeyIssuerPort {
    return new AppIngestionKeyIssuerPort(apiKeys);
  }

  async create(input: IngestionKeyCreateInput): Promise<{ token: string; apiKey: { id: string } }> {
    const result = await this.apiKeys.create({
      ...input,
      permissions: [...input.permissions],
      bindings: input.bindings.map((binding) => ({ ...binding })),
    });
    return { token: result.token, apiKey: { id: result.apiKey.id } };
  }

  revoke(input: IngestionKeyRevokeInput): Promise<void> {
    return this.apiKeys.revoke(input).then(() => undefined);
  }
}

export class AppIngestionKeyAdapter {
  private constructor(private readonly apiKeys: ApiKeyService) {}

  static create(apiKeys: ApiKeyService): AppIngestionKeyAdapter {
    return new AppIngestionKeyAdapter(apiKeys);
  }

  repository(): IngestionKeyRepository {
    return AppIngestionKeyRepository.create(this.apiKeys);
  }

  issuer(): IngestionKeyIssuerPort {
    return AppIngestionKeyIssuerPort.create(this.apiKeys);
  }
}
