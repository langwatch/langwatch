import {
  PersonalWorkspaceMissingError,
  type IngestionKeyMintCommand,
  type IssuedIngestionKey,
  type PersonalIngestionKey,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type {
  IngestionKeyIssuerPort,
  IngestionKeyRepository,
} from "../ports/ingestion-source-key.port";

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
    if (!workspace) throw new PersonalWorkspaceMissingError();

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

  async listForPersonalProject(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalIngestionKey[]> {
    const workspace = await this.organizations.tryFindPersonalWorkspace(input);
    if (!workspace) return [];

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
