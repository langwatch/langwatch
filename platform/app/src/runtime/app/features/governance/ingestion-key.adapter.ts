// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  IngestionKeyIssuerPort,
  IngestionKeyRepository,
  IngestionKeyService,
  type StoredIngestionKey,
} from "@langwatch/enterprise-governance-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { PrismaClient } from "~/generated/prisma/client";

class AppIngestionKeyRepository extends IngestionKeyRepository {
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

class AppIngestionKeyIssuerPort extends IngestionKeyIssuerPort {
  private constructor(private readonly apiKeys: ApiKeyService) {
    super();
  }

  static create(database: PrismaClient, apiKeys: ApiKeyService): AppIngestionKeyIssuerPort {
    void database;
    return new AppIngestionKeyIssuerPort(apiKeys);
  }

  async create(
    input: Parameters<IngestionKeyIssuerPort["create"]>[0],
  ): Promise<{ token: string; apiKey: { id: string } }> {
    const result = await this.apiKeys.create({
      ...input,
      permissions: [...input.permissions],
      bindings: input.bindings.map((binding) => ({ ...binding })),
    });
    return { token: result.token, apiKey: { id: result.apiKey.id } };
  }

  revoke(
    input: Parameters<IngestionKeyIssuerPort["revoke"]>[0],
  ): Promise<void> {
    return this.apiKeys.revoke(input).then(() => undefined);
  }
}

export class AppIngestionKeyAdapter {
  private constructor(
    private readonly database: PrismaClient,
    private readonly organizations: OrganizationService,
    private readonly apiKeys: ApiKeyService,
  ) {}

  static create(options: {
    database: PrismaClient;
    organizations: OrganizationService;
    apiKeys: ApiKeyService;
  }): AppIngestionKeyAdapter {
    return new AppIngestionKeyAdapter(options.database, options.organizations, options.apiKeys);
  }

  build(): IngestionKeyService {
    return IngestionKeyService.create({
      repository: AppIngestionKeyRepository.create(this.apiKeys),
      issuer: AppIngestionKeyIssuerPort.create(this.database, this.apiKeys),
      organizations: this.organizations,
    });
  }
}
