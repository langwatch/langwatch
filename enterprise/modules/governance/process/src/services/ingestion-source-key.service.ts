import { isApiKeyRevocationCause } from "@langwatch/api-key-contract";
import {
  IngestionKeyNotFoundError,
  PERSONAL_INGEST_KEYS_PER_TOOL_CAP,
  PERSONAL_INGEST_SOURCE_TYPES,
  PersonalSourceTypeNotAllowedError,
  PersonalWorkspaceMissingError,
  type IngestionKeyMintCommand,
  type IssuedIngestionKey,
  type PersonalIngestionKey,
  type PersonalIngestionKeyState,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { type OrganizationService, TeamNotFoundError } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";

import type { IngestionKeyIssuer, IngestionKeyRepository } from "../app/governance.members.ts";

const logger = createLogger("langwatch:governance:ingestion-key");

const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

export class IngestionKeyService {
  private constructor(
    private readonly repository: IngestionKeyRepository,
    private readonly issuer: IngestionKeyIssuer,
    private readonly organizations: OrganizationService,
  ) {}

  static create(options: {
    repository: IngestionKeyRepository;
    issuer: IngestionKeyIssuer;
    organizations: OrganizationService;
  }): IngestionKeyService {
    return new IngestionKeyService(options.repository, options.issuer, options.organizations);
  }

  async ensureForProject(input: IngestionKeyMintCommand): Promise<IssuedIngestionKey> {
    const prior = await this.repository.findIngestKey({
      organizationId: input.organizationId,
      projectId: input.projectId,
      sourceType: input.sourceType,
    });
    if (prior) {
      await this.issuer.revoke({
        id: prior.id,
        callerUserId: input.callerUserId,
        callerIsAdmin: true,
        organizationId: input.organizationId,
        awaitProjection: false,
        cause: "rotation",
      });
    }

    return this.mint({
      ...input,
      name: `Ingestion key (${input.sourceType})`,
    });
  }

  async issueForProject(input: IngestionKeyMintCommand): Promise<IssuedIngestionKey> {
    const origin = input.createdByDeviceLabel
      ? `${input.sourceType}, ${input.createdByDeviceLabel}`
      : input.sourceType;

    return this.mint({ ...input, name: `Ingestion key (${origin})` });
  }

  async ensureForPersonalProject(input: {
    userId: string;
    organizationId: string;
    sourceType: string;
    ingestionTemplateId?: string | null;
    createdByDeviceLabel?: string | null;
  }): Promise<IssuedIngestionKey> {
    const workspace = await this.organizations
      .getPersonalWorkspace(input)
      .catch((error: unknown) => {
        if (TeamNotFoundError.is(error)) return null;
        throw error;
      });
    if (!workspace) {
      throw new PersonalWorkspaceMissingError();
    }

    return this.ensureForProject({
      callerUserId: input.userId,
      ownerUserId: input.userId,
      organizationId: input.organizationId,
      projectId: workspace.project.id,
      sourceType: input.sourceType,
      ingestionTemplateId: input.ingestionTemplateId ?? null,
      createdByDeviceLabel: input.createdByDeviceLabel ?? null,
    });
  }

  // Issues personal-workspace key per device (no impact on others); enforces
  // per-tool cap and revokes LRU key on overflow.
  async issueForPersonalProject(input: {
    userId: string;
    organizationId: string;
    sourceType: string;
    ingestionTemplateId?: string | null;
    createdByDeviceLabel?: string | null;
  }): Promise<IssuedIngestionKey> {
    if (!(PERSONAL_INGEST_SOURCE_TYPES as readonly string[]).includes(input.sourceType)) {
      throw new PersonalSourceTypeNotAllowedError(input.sourceType);
    }

    const workspace = await this.organizations
      .getPersonalWorkspace(input)
      .catch((error: unknown) => {
        if (TeamNotFoundError.is(error)) return null;
        throw error;
      });
    if (!workspace) {
      throw new PersonalWorkspaceMissingError();
    }

    const projectId = workspace.project.id;
    const ingestionTemplateId = input.ingestionTemplateId ?? null;

    const issued = await this.issueForProject({
      callerUserId: input.userId,
      ownerUserId: input.userId,
      organizationId: input.organizationId,
      projectId,
      sourceType: input.sourceType,
      ingestionTemplateId,
      createdByDeviceLabel: input.createdByDeviceLabel ?? null,
    });

    await this.revokePastCap({
      callerUserId: input.userId,
      organizationId: input.organizationId,
      projectId,
      sourceType: input.sourceType,
      ingestionTemplateId,
      keepApiKeyId: issued.apiKeyId,
    });

    return issued;
  }

  // Revokes past-cap keys (LRU first). Best-effort post-mint: races don't fail
  // token delivery; next mint recounts and trims.
  private async revokePastCap(input: {
    callerUserId: string;
    organizationId: string;
    projectId: string;
    sourceType: string;
    ingestionTemplateId: string | null;
    keepApiKeyId: string;
  }): Promise<void> {
    const live = (
      await this.repository.findIngestKeysForProject({
        organizationId: input.organizationId,
        projectId: input.projectId,
      })
    ).filter(
      (key) =>
        key.id !== input.keepApiKeyId &&
        key.ingestSourceType === input.sourceType &&
        (key.ingestionTemplateId ?? null) === input.ingestionTemplateId,
    );
    // The kept key counts toward the cap, so the others may fill cap - 1.
    const excess = live.length - (PERSONAL_INGEST_KEYS_PER_TOOL_CAP - 1);
    if (excess <= 0) {
      return;
    }

    const lastActivityMs = (key: (typeof live)[number]): number =>
      (key.lastUsedAt ?? key.createdAt ?? EPOCH).epochMilliseconds;
    const doomed = [...live]
      .toSorted((a, b) => lastActivityMs(a) - lastActivityMs(b))
      .slice(0, excess);
    for (const key of doomed) {
      try {
        await this.issuer.revoke({
          id: key.id,
          callerUserId: input.callerUserId,
          callerIsAdmin: true,
          organizationId: input.organizationId,
          awaitProjection: false,
          cause: "cap",
        });
      } catch (error) {
        logger.warn(
          {
            error,
            apiKeyId: key.id,
            projectId: input.projectId,
            sourceType: input.sourceType,
          },
          "could not retire a personal ingest key past the cap",
        );
      }
    }
  }

  /**
   * What became of one of the caller's own personal ingest keys, by the lookup
   * id in its token. A cap-retired or rotated key may be re-minted; a
   * person-revoked one may not. Another user's key throws the same not-found.
   */
  async getPersonalKeyState(input: {
    userId: string;
    organizationId: string;
    lookupId: string;
  }): Promise<PersonalIngestionKeyState> {
    const key = await this.repository.findByLookupId({ lookupId: input.lookupId });
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

  async listForPersonalProject(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalIngestionKey[]> {
    const workspace = await this.organizations
      .getPersonalWorkspace(input)
      .catch((error: unknown) => {
        if (TeamNotFoundError.is(error)) return null;
        throw error;
      });
    if (!workspace) {
      return [];
    }

    const keys = await this.repository.findIngestKeysForProject({
      organizationId: input.organizationId,
      projectId: workspace.project.id,
    });

    return keys.flatMap((key) =>
      key.ingestSourceType
        ? [
            {
              apiKeyId: key.id,
              sourceType: key.ingestSourceType,
              lookupId: key.lookupId,
              ingestionTemplateId: key.ingestionTemplateId,
            },
          ]
        : [],
    );
  }

  private async mint(
    input: IngestionKeyMintCommand & { name: string },
  ): Promise<IssuedIngestionKey> {
    const { token, apiKey } = await this.issuer.create({
      name: input.name,
      userId: input.ownerUserId,
      createdByUserId: input.callerUserId,
      organizationId: input.organizationId,
      permissionMode: "restricted",
      permissions: ["traces:create"],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: input.projectId }],
      ingestSourceType: input.sourceType,
      ingestionTemplateId: input.ingestionTemplateId ?? null,
      createdByDeviceLabel: input.createdByDeviceLabel ?? null,
    });

    return {
      token,
      apiKeyId: apiKey.id,
      prefix: token.slice(0, 12),
      sourceType: input.sourceType,
    };
  }
}
