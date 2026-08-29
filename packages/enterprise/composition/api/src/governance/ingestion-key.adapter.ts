// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ApiKeyService } from "@langwatch/api-key-contract";
import {
  IngestionKeyIssuerPort,
  IngestionKeyRepository,
  type StoredIngestionKey,
} from "@langwatch/enterprise-governance-server";

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
  callerIsAdmin: true;
  organizationId: string;
  awaitProjection: false;
};

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
    return this.apiKeys.tryGetIngestionKey(input);
  }

  findIngestKeysForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<StoredIngestionKey[]> {
    return this.apiKeys.listIngestionKeysForProject(input);
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
