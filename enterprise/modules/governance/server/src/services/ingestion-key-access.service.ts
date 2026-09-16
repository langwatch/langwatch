// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Ingestion keys are API keys, so the module owns none of their state: both
 * classes here answer `../app/governance.members.ts` interfaces by delegating
 * straight to `ApiKeyApi`, the peer that owns the concept.
 */
import type { ApiKeyApi, ApiKeyRevocationCause } from "@langwatch/api-key-contract";
import { fromDate } from "@langwatch/time";
import type {
  IngestionKeyIssuer,
  IngestionKeyRepository,
  StoredIngestionKey,
  StoredIngestionKeyOwnership,
} from "../app/governance.members.ts";

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
type ApiKeyIngestionRow = Awaited<ReturnType<ApiKeyApi["listIngestionKeysForProject"]>>[number];

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

export class ApiKeyIngestionKeyRepositoryService implements IngestionKeyRepository {
  private constructor(private readonly apiKeys: ApiKeyApi) {}

  static create(apiKeys: ApiKeyApi): ApiKeyIngestionKeyRepositoryService {
    return new ApiKeyIngestionKeyRepositoryService(apiKeys);
  }

  findIngestKey(input: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<StoredIngestionKey | null> {
    return this.apiKeys
      .findIngestionKey(input)
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

  async findByLookupId(input: {
    lookupId: string;
  }): Promise<StoredIngestionKeyOwnership | null> {
    const key = await this.apiKeys.findByLookupId(input);
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

export class ApiKeyIngestionKeyIssuerService implements IngestionKeyIssuer {
  private constructor(private readonly apiKeys: ApiKeyApi) {}

  static create(apiKeys: ApiKeyApi): ApiKeyIngestionKeyIssuerService {
    return new ApiKeyIngestionKeyIssuerService(apiKeys);
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
