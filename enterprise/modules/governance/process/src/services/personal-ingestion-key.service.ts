// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The /me trace-ingest keys a member mints outside any CLI session: a port of
 * main's IngestionKeyService (platform/app/ee/governance/services/ingestionKey.service.ts).
 */
import {
  type ApiKey,
  type ApiKeyApi,
  ApiKeyAlreadyRevokedError,
} from "@langwatch/api-key-contract";
import {
  IngestionKeyNotFoundError,
  IngestionKeyRevokeIncompleteError,
  IngestionKeySourceNotAllowedError,
  IngestionKeyWorkspaceMissingError,
  PERSONAL_INGEST_SOURCE_TYPES,
  type IssuedIngestionKey,
  type PersonalIngestionKeyListing,
  type PersonalIngestionKeyMint,
  type RotatedIngestionKey,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { type OrganizationService, TeamNotFoundError } from "@langwatch/organization-contract";

import type { IngestionTemplateRepository } from "../repositories/ingestion-template.repository.ts";

const logger = createLogger("langwatch:governance:ingestion-key");

export class PersonalIngestionKeyService {
  private constructor(
    private readonly apiKeys: Pick<
      ApiKeyApi,
      "create" | "revoke" | "findById" | "findIngestionKeysForUser"
    >,
    private readonly organizations: Pick<OrganizationService, "getPersonalWorkspace">,
    private readonly templates: IngestionTemplateRepository,
  ) {}

  static create(options: {
    apiKeys: Pick<ApiKeyApi, "create" | "revoke" | "findById" | "findIngestionKeysForUser">;
    organizations: Pick<OrganizationService, "getPersonalWorkspace">;
    templates: IngestionTemplateRepository;
  }): PersonalIngestionKeyService {
    return new PersonalIngestionKeyService(
      options.apiKeys,
      options.organizations,
      options.templates,
    );
  }

  async list(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalIngestionKeyListing[]> {
    const keys = await this.apiKeys.findIngestionKeysForUser(input);
    return keys.flatMap((key) =>
      key.ingestSourceType
        ? [
            {
              apiKeyId: key.id,
              name: key.name,
              sourceType: key.ingestSourceType,
              lookupId: key.lookupId,
              ingestionTemplateId: key.ingestionTemplateId,
              deviceLabel: key.createdByDeviceLabel,
              parentApiKeyId: key.parentApiKeyId ?? null,
              createdAtMs: key.createdAt.getTime(),
              lastUsedAtMs: key.lastUsedAt?.getTime() ?? null,
            },
          ]
        : [],
    );
  }

  async mint(input: PersonalIngestionKeyMint): Promise<IssuedIngestionKey> {
    await this.assertMintableWithoutSession(input);
    const workspace = await this.organizations
      .getPersonalWorkspace(input)
      .catch((error: unknown) => {
        if (TeamNotFoundError.is(error)) return null;
        throw error;
      });
    if (!workspace) {
      throw new IngestionKeyWorkspaceMissingError();
    }

    const { token, apiKey } = await this.apiKeys.create({
      name: `Ingestion key (${input.sourceType})`,
      userId: input.userId,
      createdByUserId: input.userId,
      organizationId: input.organizationId,
      permissionMode: "restricted",
      permissions: ["traces:create"],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: workspace.project.id }],
      ingestSourceType: input.sourceType,
      ingestionTemplateId: input.ingestionTemplateId,
      createdByDeviceLabel: null,
      parentApiKeyId: null,
    });
    return { token, apiKeyId: apiKey.id, prefix: token.slice(0, 12), sourceType: input.sourceType };
  }

  async rotate(input: PersonalIngestionKeyMint): Promise<RotatedIngestionKey> {
    const revoked = await this.revokeForSource(input);
    const issued = await this.mint(input);
    return {
      ...issued,
      revokedCount: revoked.revokedCount,
      revokedDeviceLabels: revoked.deviceLabels,
    };
  }

  async revoke(input: { userId: string; organizationId: string; apiKeyId: string }): Promise<void> {
    const key = await this.apiKeys.findById({ id: input.apiKeyId });
    if (
      !key ||
      key.organizationId !== input.organizationId ||
      key.userId !== input.userId ||
      !key.ingestSourceType
    ) {
      throw new IngestionKeyNotFoundError(input.apiKeyId);
    }
    if (key.revokedAt) return;
    try {
      await this.apiKeys.revoke({
        id: key.id,
        callerUserId: input.userId,
        callerIsAdmin: false,
        organizationId: input.organizationId,
        cause: "user",
      });
    } catch (error) {
      if (ApiKeyAlreadyRevokedError.is(error)) return;
      throw error;
    }
  }

  private async revokeForSource(
    input: PersonalIngestionKeyMint,
  ): Promise<{ revokedCount: number; deviceLabels: string[] }> {
    await this.assertMintableWithoutSession(input);
    const prior = (await this.apiKeys.findIngestionKeysForUser(input)).filter(
      (key) =>
        key.ingestSourceType === input.sourceType &&
        (key.ingestionTemplateId ?? null) === input.ingestionTemplateId,
    );

    const deviceLabels: string[] = [];
    const survivors: string[] = [];
    for (const key of prior) {
      try {
        await this.apiKeys.revoke({
          id: key.id,
          callerUserId: input.userId,
          callerIsAdmin: false,
          organizationId: input.organizationId,
          awaitProjection: false,
          cause: "rotation",
        });
        deviceLabels.push(labelOf(key));
      } catch (error) {
        if (ApiKeyAlreadyRevokedError.is(error)) continue;
        logger.warn(
          { error, apiKeyId: key.id, sourceType: input.sourceType },
          "could not revoke a prior ingest key during rotation",
        );
        survivors.push(labelOf(key));
      }
    }
    if (survivors.length > 0) {
      throw new IngestionKeyRevokeIncompleteError(survivors);
    }
    return { revokedCount: deviceLabels.length, deviceLabels };
  }

  private async assertMintableWithoutSession(input: PersonalIngestionKeyMint): Promise<void> {
    const wrapped = PERSONAL_INGEST_SOURCE_TYPES.some((type) => type === input.sourceType);
    if (wrapped || !input.ingestionTemplateId) {
      throw new IngestionKeySourceNotAllowedError(input.sourceType);
    }
    const template = await this.templates.findVisible({
      id: input.ingestionTemplateId,
      organizationId: input.organizationId,
    });
    if (template?.sourceType !== input.sourceType) {
      throw new IngestionKeySourceNotAllowedError(input.sourceType);
    }
  }
}

function labelOf(key: ApiKey): string {
  return key.createdByDeviceLabel ?? key.name;
}
