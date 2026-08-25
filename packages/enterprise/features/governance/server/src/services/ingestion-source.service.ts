import {
  GOVERNANCE_INGESTION_SOURCE_TYPES,
  GovernanceIngestionSourceService,
  GovernanceValidationError,
  IngestionSourceCapReachedError,
  IngestionSourceNotFoundError,
  NON_ENTERPRISE_INGESTION_SOURCE_CAP,
  pullScheduleSchema,
  unsupportedValue,
  type CreatedGovernanceIngestionSource,
  type CreateGovernanceIngestionSourceCommand,
  type GovernanceIngestionSource,
  type UpdateGovernanceIngestionSourceCommand,
} from "@langwatch/enterprise-governance-contract";
import {
  PROJECT_KIND,
  type ProjectService,
} from "@langwatch/project-contract";
import type { GovernanceDiagnosticsPort } from "../ports/governance-diagnostics.port";
import type {
  IngestionSourceEntitlementsPort,
  IngestionSourceLifecyclePort,
  IngestionSourceRepository,
  UpdateIngestionSourceRecord,
} from "../ports/ingestion-source.port";
import type { IngestionCredentialsService } from "./ingestion-credentials.service";
import type { IngestionSecretService } from "./ingestion-source-secret.service";
import type { PullDestinationService } from "./pull-destination.service";

const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

export class IngestionSourceService extends GovernanceIngestionSourceService {
  private constructor(
    private readonly repository: IngestionSourceRepository,
    private readonly projects: ProjectService,
    private readonly entitlements: IngestionSourceEntitlementsPort,
    private readonly lifecycle: IngestionSourceLifecyclePort,
    private readonly credentials: IngestionCredentialsService,
    private readonly secrets: IngestionSecretService,
    private readonly destinations: PullDestinationService,
    private readonly diagnostics: GovernanceDiagnosticsPort,
    private readonly now: () => number,
  ) {
    super();
  }

  static create(options: {
    repository: IngestionSourceRepository;
    projects: ProjectService;
    entitlements: IngestionSourceEntitlementsPort;
    lifecycle: IngestionSourceLifecyclePort;
    credentials: IngestionCredentialsService;
    secrets: IngestionSecretService;
    destinations: PullDestinationService;
    diagnostics: GovernanceDiagnosticsPort;
    now?: () => number;
  }): IngestionSourceService {
    return new IngestionSourceService(
      options.repository,
      options.projects,
      options.entitlements,
      options.lifecycle,
      options.credentials,
      options.secrets,
      options.destinations,
      options.diagnostics,
      options.now ?? Date.now,
    );
  }

  list(organizationId: string): Promise<GovernanceIngestionSource[]> {
    return this.repository.list(organizationId);
  }

  async tryFindById(
    id: string,
    organizationId: string,
  ): Promise<GovernanceIngestionSource | null> {
    const row = await this.repository.tryFindById(id);
    return row?.organizationId === organizationId ? row : null;
  }

  async tryFindByIngestSecret(
    rawSecret: string,
  ): Promise<GovernanceIngestionSource | null> {
    const candidateHash = this.secrets.hash(rawSecret);
    const direct = await this.repository.tryFindByCurrentSecretHash(candidateHash);
    if (direct) return direct;

    const candidates =
      await this.repository.findByPriorSecretHash(candidateHash);
    const now = this.now();
    return (
      candidates.find((candidate) => {
        const rotation = candidate.parserConfig._rotation as
          | { priorHash?: string; expiresAt?: number }
          | undefined;
        return (
          rotation?.priorHash === candidateHash &&
          typeof rotation.expiresAt === "number" &&
          rotation.expiresAt > now
        );
      }) ?? null
    );
  }

  async createSource(
    input: CreateGovernanceIngestionSourceCommand,
  ): Promise<CreatedGovernanceIngestionSource> {
    this.assertPullSchedule(input.pullSchedule);
    if (!(await this.entitlements.hasEnterprisePlan(input.organizationId))) {
      const existing = await this.repository.countLive(input.organizationId);
      if (existing >= NON_ENTERPRISE_INGESTION_SOURCE_CAP) {
        throw new IngestionSourceCapReachedError(
          NON_ENTERPRISE_INGESTION_SOURCE_CAP,
        );
      }
    }

    if (!GOVERNANCE_INGESTION_SOURCE_TYPES.includes(input.sourceType)) {
      throw unsupportedValue({
        field: "sourceType",
        value: input.sourceType,
        allowed: GOVERNANCE_INGESTION_SOURCE_TYPES,
      });
    }

    await this.projects.ensureInternal({
      organizationId: input.organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    const ingestSecret = this.secrets.generate();
    const requestedParserConfig = {
      ...(input.pullConfig ?? {}),
      ...(input.parserConfig ?? {}),
    };
    this.destinations.assertAllowed(requestedParserConfig);
    const parserConfig =
      this.credentials.tryEncryptParserConfig(requestedParserConfig) ?? {};
    const source = await this.repository.create({
      organizationId: input.organizationId,
      teamId: input.teamId ?? null,
      sourceType: input.sourceType,
      name: input.name,
      description: input.description ?? null,
      ingestSecretHash: this.secrets.hash(ingestSecret),
      parserConfig,
      pullSchedule: input.pullSchedule ?? null,
      status: "awaiting_first_event",
      createdById: input.actorUserId,
    });
    if (source.pullSchedule) await this.syncBestEffort(source);
    return { source, ingestSecret };
  }

  async updateSource(
    input: UpdateGovernanceIngestionSourceCommand,
  ): Promise<GovernanceIngestionSource> {
    const existing = await this.getById(input.id, input.organizationId);
    this.assertPullSchedule(input.pullSchedule);
    const update: UpdateIngestionSourceRecord = {};
    if (input.name !== undefined) update.name = input.name;
    if (input.description !== undefined) update.description = input.description;
    if (input.status !== undefined) update.status = input.status;
    if (input.teamId !== undefined) update.teamId = input.teamId;
    if (input.pullSchedule !== undefined)
      update.pullSchedule = input.pullSchedule;
    if (input.parserConfig !== undefined) {
      const incoming = { ...input.parserConfig };
      if (this.credentials.isEncrypted(incoming.credentials)) {
        const message =
          "Credentials cannot be submitted in their stored form. Re-enter the secret to change this source, or omit it to keep the current one.";
        throw new GovernanceValidationError(message, {
          formErrors: [message],
        });
      }
      for (const key of Object.keys(existing.parserConfig)) {
        if (
          (key === "credentials" || key.startsWith("_")) &&
          incoming[key] === undefined
        ) {
          incoming[key] = existing.parserConfig[key];
        }
      }
      this.destinations.assertAllowed(incoming);
      update.parserConfig =
        this.credentials.tryEncryptParserConfig(incoming) ?? incoming;
    }

    const source = await this.repository.update(existing.id, update);
    if (existing.pullSchedule !== null || source.pullSchedule !== null) {
      await this.syncBestEffort(source);
    }
    return source;
  }

  async rotateSecret(
    id: string,
    organizationId: string,
  ): Promise<CreatedGovernanceIngestionSource> {
    const existing = await this.getById(id, organizationId);
    const ingestSecret = this.secrets.generate();
    const parserConfig = this.credentials.tryEncryptParserConfig({
      ...existing.parserConfig,
      _rotation: {
        priorHash: existing.ingestSecretHash,
        expiresAt: this.now() + ROTATION_GRACE_MS,
      },
    })!;
    const source = await this.repository.update(existing.id, {
      ingestSecretHash: this.secrets.hash(ingestSecret),
      parserConfig,
    });
    return { source, ingestSecret };
  }

  async archive(
    id: string,
    organizationId: string,
  ): Promise<GovernanceIngestionSource> {
    const existing = await this.getById(id, organizationId);
    const source = await this.repository.update(existing.id, {
      archivedAt: new Date(this.now()),
      status: "disabled",
    });
    if (source.pullSchedule) await this.syncBestEffort(source);
    return source;
  }

  async recordEventReceived(id: string): Promise<void> {
    await this.repository.update(id, {
      lastEventAt: new Date(this.now()),
      status: "active",
    });
  }

  async getById(
    id: string,
    organizationId: string,
  ): Promise<GovernanceIngestionSource> {
    const source = await this.tryFindById(id, organizationId);
    if (!source) throw new IngestionSourceNotFoundError(id);
    return source;
  }

  private assertPullSchedule(value: string | null | undefined): void {
    if (value == null) return;
    const parsed = pullScheduleSchema.safeParse(value);
    if (parsed.success) return;
    const complaints = parsed.error.issues.map((issue) => issue.message);
    throw new GovernanceValidationError(
      complaints.join(" ") || "Pull schedule is not a valid cron expression",
      { formErrors: complaints },
    );
  }

  private async syncBestEffort(
    source: GovernanceIngestionSource,
  ): Promise<void> {
    try {
      await this.lifecycle.sync(source);
    } catch (error) {
      this.diagnostics.warn(
        "Failed to sync ingestion pull process; boot reconciliation will retry",
        {
          sourceId: source.id,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
