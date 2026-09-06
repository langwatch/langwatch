import { isApiKeyRevocationCause } from "@langwatch/api-key-contract";
import {
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
import type { OrganizationService } from "@langwatch/organization-contract";
import type {
  IngestionKeyIssuerPort,
  IngestionKeyRepository,
} from "../ports/ingestion-source-key.port";

const logger = createLogger("langwatch:governance:ingestion-key");

export class IngestionKeyService {
  private constructor(
    private readonly repository: IngestionKeyRepository,
    private readonly issuer: IngestionKeyIssuerPort,
    private readonly organizations: OrganizationService,
  ) {}

  static create(options: {
    repository: IngestionKeyRepository;
    issuer: IngestionKeyIssuerPort;
    organizations: OrganizationService;
  }): IngestionKeyService {
    return new IngestionKeyService(options.repository, options.issuer, options.organizations);
  }

  async ensureForProject(input: IngestionKeyMintCommand): Promise<IssuedIngestionKey> {
    const prior = await this.repository.tryFindIngestKey({
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
    const workspace = await this.organizations.tryFindPersonalWorkspace(input);
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

  /**
   * Issues a personal-workspace key WITHOUT touching the keys other machines
   * hold for the same tool: the create-only shape, held to
   * `PERSONAL_INGEST_KEYS_PER_TOOL_CAP` live keys per (workspace, sourceType,
   * template). Past the cap the least recently used key is revoked.
   *
   * This is the CLI device-session mint: every device that signs in gets its
   * own key, and no device's mint can break another device's telemetry.
   */
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

    const workspace = await this.organizations.tryFindPersonalWorkspace(input);
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

  /**
   * The cap behind {@link issueForPersonalProject}: revoke live keys for the
   * same (project, sourceType, template) beyond the cap, least recently used
   * first. A key never used ranks by its creation time.
   *
   * Best-effort by design, and it runs after the new key exists: two devices
   * minting at once can pick the same key to retire, and the loser is not a
   * reason to fail a mint whose token is already in the caller's hands. The
   * bound is recounted on every mint, so the next one trims what a race left.
   */
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
      (key.lastUsedAt ?? key.createdAt ?? new Date(0)).getTime();
    const doomed = [...live].sort((a, b) => lastActivityMs(a) - lastActivityMs(b)).slice(0, excess);
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
   * id embedded in its token. The CLI asks before it re-mints a key the
   * collector rejected: a key the cap retired or a rotation replaced may be
   * re-minted, a key a person revoked may not. Null when no such key belongs to
   * this user here, which is also what another user's key reads as.
   */
  async describePersonalKey(input: {
    userId: string;
    organizationId: string;
    lookupId: string;
  }): Promise<PersonalIngestionKeyState | null> {
    const key = await this.repository.tryFindByLookupId({ lookupId: input.lookupId });
    if (
      !key ||
      key.organizationId !== input.organizationId ||
      key.userId !== input.userId ||
      !key.ingestSourceType
    ) {
      return null;
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
    const workspace = await this.organizations.tryFindPersonalWorkspace(input);
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
