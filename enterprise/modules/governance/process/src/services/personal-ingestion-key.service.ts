// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Ingest-only ApiKeys: the /me tile, MCP and CLI-session mints and the pinned
 * `--project` path. A port of main's IngestionKeyService (platform/app/ee/governance/services/ingestionKey.service.ts).
 */
import {
  type ApiKey,
  type ApiKeyApi,
  ApiKeyAlreadyRevokedError,
  isApiKeyRevocationCause,
} from "@langwatch/api-key-contract";
import {
  IngestionKeyNotFoundError,
  IngestionKeyRevokeIncompleteError,
  IngestionKeySessionRevokedError,
  IngestionKeySourceNotAllowedError,
  IngestionKeyWorkspaceMissingError,
  PERSONAL_INGEST_SOURCE_TYPES,
  type IngestionKeyMintCommand,
  type IssuedIngestionKey,
  type PersonalIngestionKeyListing,
  type PersonalIngestionKeyMint,
  type PersonalIngestionKeyState,
  type RotatedIngestionKey,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { type OrganizationService, TeamNotFoundError } from "@langwatch/organization-contract";

import type { IngestionTemplateRepository } from "../repositories/ingestion-template.repository.ts";

const logger = createLogger("langwatch:governance:ingestion-key");

type IngestionKeyStore = Pick<
  ApiKeyApi,
  "create" | "revoke" | "findById" | "findByLookupId" | "findIngestionKeysForUser"
>;

export class PersonalIngestionKeyService {
  private constructor(
    private readonly apiKeys: IngestionKeyStore,
    private readonly organizations: Pick<OrganizationService, "getPersonalWorkspace">,
    private readonly templates: IngestionTemplateRepository,
  ) {}

  static create(options: {
    apiKeys: IngestionKeyStore;
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

  /** The pinned `--project` path: create-only, so no other machine's key dies. */
  async issueForProject(input: IngestionKeyMintCommand): Promise<IssuedIngestionKey> {
    const origin = input.createdByDeviceLabel
      ? `${input.sourceType}, ${input.createdByDeviceLabel}`
      : input.sourceType;
    return this.createKey({
      name: `Ingestion key (${origin})`,
      callerUserId: input.callerUserId,
      ownerUserId: input.ownerUserId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      sourceType: input.sourceType,
      ingestionTemplateId: input.ingestionTemplateId ?? null,
      createdByDeviceLabel: input.createdByDeviceLabel ?? null,
      parentApiKeyId: null,
    });
  }

  async mint(input: PersonalIngestionKeyMint): Promise<IssuedIngestionKey> {
    const parentApiKeyId = input.parentApiKeyId ?? null;
    const ingestionTemplateId = input.ingestionTemplateId ?? null;
    if (input.fromCliSession ?? parentApiKeyId !== null) {
      if (!isWrappedTool(input.sourceType)) {
        throw new IngestionKeySourceNotAllowedError(input.sourceType);
      }
      if (parentApiKeyId && !(await this.isSessionLive({ ...input, parentApiKeyId }))) {
        throw new IngestionKeySessionRevokedError();
      }
    } else {
      await this.assertMintableWithoutSession(input);
    }

    const workspace = await this.organizations
      .getPersonalWorkspace(input)
      .catch((error: unknown) => {
        if (TeamNotFoundError.is(error)) return null;
        throw error;
      });
    if (!workspace) {
      throw new IngestionKeyWorkspaceMissingError();
    }

    const createdByDeviceLabel = input.createdByDeviceLabel ?? null;
    const origin = createdByDeviceLabel
      ? `${input.sourceType}, ${createdByDeviceLabel}`
      : input.sourceType;
    const issued = await this.createKey({
      name: `Ingestion key (${origin})`,
      callerUserId: input.userId,
      ownerUserId: input.userId,
      organizationId: input.organizationId,
      projectId: workspace.project.id,
      sourceType: input.sourceType,
      ingestionTemplateId,
      createdByDeviceLabel,
      parentApiKeyId,
    });
    if (parentApiKeyId) {
      await this.retireIfSessionEndedDuringMint({ ...input, parentApiKeyId, issued });
    }
    return issued;
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
        (key.ingestionTemplateId ?? null) === (input.ingestionTemplateId ?? null),
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

  /** What became of one of the caller's own keys; another member's reads as not found. */
  async getPersonalKeyState(input: {
    userId: string;
    organizationId: string;
    lookupId: string;
  }): Promise<PersonalIngestionKeyState> {
    const key = await this.apiKeys.findByLookupId({ lookupId: input.lookupId });
    if (
      !key ||
      key.organizationId !== input.organizationId ||
      key.userId !== input.userId ||
      !key.ingestSourceType
    ) {
      throw new IngestionKeyNotFoundError(input.lookupId);
    }
    return {
      sourceType: key.ingestSourceType,
      live: key.revokedAt === null,
      revocationCause: isApiKeyRevocationCause(key.revocationCause) ? key.revocationCause : null,
    };
  }

  private async createKey(input: {
    name: string;
    callerUserId: string;
    ownerUserId: string | null;
    organizationId: string;
    projectId: string;
    sourceType: string;
    ingestionTemplateId: string | null;
    createdByDeviceLabel: string | null;
    parentApiKeyId: string | null;
  }): Promise<IssuedIngestionKey> {
    const { token, apiKey } = await this.apiKeys.create({
      name: input.name,
      userId: input.ownerUserId,
      createdByUserId: input.callerUserId,
      organizationId: input.organizationId,
      permissionMode: "restricted",
      permissions: ["traces:create"],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: input.projectId }],
      ingestSourceType: input.sourceType,
      ingestionTemplateId: input.ingestionTemplateId,
      createdByDeviceLabel: input.createdByDeviceLabel,
      parentApiKeyId: input.parentApiKeyId,
    });
    return { token, apiKeyId: apiKey.id, prefix: token.slice(0, 12), sourceType: input.sourceType };
  }

  private async isSessionLive(input: {
    parentApiKeyId: string;
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const parent = await this.apiKeys.findById({ id: input.parentApiKeyId });
    return (
      !!parent &&
      parent.organizationId === input.organizationId &&
      parent.userId === input.userId &&
      parent.revokedAt === null
    );
  }

  /** A session revoked mid-mint must not leave a live child behind: retire it and refuse. */
  private async retireIfSessionEndedDuringMint(input: {
    parentApiKeyId: string;
    userId: string;
    organizationId: string;
    issued: IssuedIngestionKey;
  }): Promise<void> {
    if (await this.isSessionLive(input)) return;
    try {
      await this.apiKeys.revoke({
        id: input.issued.apiKeyId,
        callerUserId: input.userId,
        callerIsAdmin: false,
        organizationId: input.organizationId,
        awaitProjection: false,
        cause: "session",
      });
    } catch (error) {
      if (!ApiKeyAlreadyRevokedError.is(error)) {
        logger.warn(
          { error, apiKeyId: input.issued.apiKeyId, parentApiKeyId: input.parentApiKeyId },
          "could not retire a key whose session ended while it was minted",
        );
      }
    }
    throw new IngestionKeySessionRevokedError();
  }

  private async assertMintableWithoutSession(input: PersonalIngestionKeyMint): Promise<void> {
    if (isWrappedTool(input.sourceType) || !input.ingestionTemplateId) {
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

function isWrappedTool(sourceType: string): boolean {
  return PERSONAL_INGEST_SOURCE_TYPES.some((type) => type === sourceType);
}
