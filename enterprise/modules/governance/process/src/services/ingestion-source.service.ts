import {
  GOVERNANCE_INGESTION_SOURCE_TYPES,
  GovernanceValidationError,
  isPushSourceType,
  IngestionSourceCapReachedError,
  IngestionSourceNotFoundError,
  NON_ENTERPRISE_INGESTION_SOURCE_CAP,
  unsupportedValue,
  type CreatedGovernanceIngestionSource,
  type CreateGovernanceIngestionSourceCommand,
  type GovernanceIngestionSource,
  type UpdateGovernanceIngestionSourceCommand,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";

import type { ProviderAccountChannel } from "../channels/provider-account.channel.ts";
import type {
  IngestionSourceRepository,
  UpdateIngestionSourceRecord,
} from "../repositories/ingestion-source.repository.ts";
import type { GovernanceDiagnosticsSink } from "./governance-policy.service.ts";
import { IngestionSourceParserConfigService } from "./ingestion-source-parser-config.service.ts";
import type { IngestionSecretService } from "./ingestion-source-secret.service.ts";
import { IngestionSourceValidationService } from "./ingestion-source-validation.service.ts";
import type { PullDestinationService } from "./pull-destination.service.ts";

export interface IngestionSourceEntitlements {
  hasEnterprisePlan(organizationId: string): Promise<boolean>;
}

export interface IngestionSourceLifecycleChannel {
  sync(source: GovernanceIngestionSource): Promise<void>;
}

const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

type IngestionSourceProjects = Pick<
  ProjectApi,
  "ensureInternal" | "listActiveByScopes" | "findWithTeam"
>;

export class IngestionSourceService {
  private readonly repository: IngestionSourceRepository;
  private readonly projects: IngestionSourceProjects;
  private readonly entitlements: IngestionSourceEntitlements;
  private readonly lifecycle: IngestionSourceLifecycleChannel;
  private readonly secrets: IngestionSecretService;
  private readonly destinations: PullDestinationService;
  private readonly providerAccounts: ProviderAccountChannel;
  private readonly diagnostics: GovernanceDiagnosticsSink;
  private readonly now: () => number;
  private readonly validation: IngestionSourceValidationService;
  private readonly parserConfigs: IngestionSourceParserConfigService;

  private constructor({
    repository,
    projects,
    entitlements,
    lifecycle,
    secrets,
    destinations,
    providerAccounts,
    diagnostics,
    now,
    validation,
    parserConfigs,
  }: {
    repository: IngestionSourceRepository;
    projects: IngestionSourceProjects;
    entitlements: IngestionSourceEntitlements;
    lifecycle: IngestionSourceLifecycleChannel;
    secrets: IngestionSecretService;
    destinations: PullDestinationService;
    providerAccounts: ProviderAccountChannel;
    diagnostics: GovernanceDiagnosticsSink;
    now: () => number;
    validation: IngestionSourceValidationService;
    parserConfigs: IngestionSourceParserConfigService;
  }) {
    this.repository = repository;
    this.projects = projects;
    this.entitlements = entitlements;
    this.lifecycle = lifecycle;
    this.secrets = secrets;
    this.destinations = destinations;
    this.providerAccounts = providerAccounts;
    this.diagnostics = diagnostics;
    this.now = now;
    this.validation = validation;
    this.parserConfigs = parserConfigs;
  }

  static create(options: {
    repository: IngestionSourceRepository;
    projects: IngestionSourceProjects;
    entitlements: IngestionSourceEntitlements;
    lifecycle: IngestionSourceLifecycleChannel;
    secrets: IngestionSecretService;
    destinations: PullDestinationService;
    providerAccounts: ProviderAccountChannel;
    diagnostics: GovernanceDiagnosticsSink;
    now?: () => number;
  }): IngestionSourceService {
    return new IngestionSourceService({
      repository: options.repository,
      projects: options.projects,
      entitlements: options.entitlements,
      lifecycle: options.lifecycle,
      secrets: options.secrets,
      destinations: options.destinations,
      providerAccounts: options.providerAccounts,
      diagnostics: options.diagnostics,
      now: options.now ?? Date.now,
      validation: IngestionSourceValidationService.create({ projects: options.projects }),
      parserConfigs: IngestionSourceParserConfigService.create({
        repository: options.repository,
        providerAccounts: options.providerAccounts,
      }),
    });
  }

  /** Whether a source's stored `pollerCursor` holds a real cursor. */
  static hasPollerCursor(value: unknown): boolean {
    return IngestionSourceValidationService.hasPollerCursor(value);
  }

  list(organizationId: string): Promise<GovernanceIngestionSource[]> {
    return this.repository.findAll(organizationId);
  }

  async findById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<GovernanceIngestionSource | null> {
    const row = await this.repository.findById(id);

    return row?.organizationId === organizationId ? row : null;
  }

  async findByIngestSecret(rawSecret: string): Promise<GovernanceIngestionSource | null> {
    const candidateHash = this.secrets.hash(rawSecret);
    const direct = await this.repository.findByCurrentSecretHash(candidateHash);
    if (direct) {
      return direct;
    }

    const candidates = await this.repository.findByPriorSecretHash(candidateHash);
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
    this.validation.assertPullSchedule(input.pullSchedule);
    if (!(await this.entitlements.hasEnterprisePlan(input.organizationId))) {
      const existing = await this.repository.countLive(input.organizationId);
      if (existing >= NON_ENTERPRISE_INGESTION_SOURCE_CAP) {
        throw new IngestionSourceCapReachedError(NON_ENTERPRISE_INGESTION_SOURCE_CAP);
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
    // Only a push source has a secret at all: a pull-mode or pure-S3 source
    // authenticates outbound, so a minted secret would be stored and shown
    // without ever authenticating anything. The empty hash is the sentinel for
    // "there is no secret here", which is what the ingest door reads.
    const ingestSecret = isPushSourceType({ sourceType: input.sourceType })
      ? this.secrets.generate()
      : null;
    const requestedParserConfig = {
      ...input.pullConfig,
      ...input.parserConfig,
    };
    this.destinations.assertAllowed(requestedParserConfig);
    const { providerAccountId } = await this.parserConfigs.assertClaimsAreFree({
      organizationId: input.organizationId,
      sourceType: input.sourceType,
      parserConfig: requestedParserConfig,
    });
    await this.validation.assertTraceDestination({
      organizationId: input.organizationId,
      traceProjectId: input.traceProjectId,
    });
    const parserConfig = await this.parserConfigs.prepareParserConfig({
      organizationId: input.organizationId,
      parserConfig: requestedParserConfig,
    });
    const source = await this.repository.create({
      organizationId: input.organizationId,
      teamId: input.teamId ?? null,
      traceProjectId: input.traceProjectId ?? null,
      sourceType: input.sourceType,
      name: input.name,
      description: input.description ?? null,
      ingestSecretHash: ingestSecret === null ? "" : this.secrets.hash(ingestSecret),
      parserConfig,
      pullSchedule: input.pullSchedule ?? null,
      status: "awaiting_first_event",
      createdById: input.actorUserId,
      providerAccountId: providerAccountId ?? null,
    });
    if (source.pullSchedule) {
      await this.syncBestEffort(source);
    }

    return { source, ingestSecret };
  }

  async updateSource(
    input: UpdateGovernanceIngestionSourceCommand,
  ): Promise<GovernanceIngestionSource> {
    const existing = await this.getById({ id: input.id, organizationId: input.organizationId });
    this.validation.assertPullSchedule(input.pullSchedule);
    const update: UpdateIngestionSourceRecord = this.plainUpdateFields(input);
    let cursorMustNotMove = false;
    if (input.parserConfig !== undefined) {
      const incoming = this.parserConfigs.mergedParserConfig({
        existing,
        incoming: input.parserConfig,
      });
      this.validation.assertAdapterUnchanged(existing.parserConfig, incoming);
      cursorMustNotMove = this.validation.assertReportUnchangedOncePulled(existing, incoming);
      this.destinations.assertAllowed(incoming);
      this.parserConfigs.assertRepointAllowed({ existing, incoming });
      const { providerAccountId } = await this.parserConfigs.assertClaimsAreFree({
        organizationId: input.organizationId,
        sourceType: existing.sourceType,
        parserConfig: incoming,
        existing,
        resentCredentials: input.parserConfig.credentials !== undefined,
      });
      if (providerAccountId !== undefined) {
        update.providerAccountId = providerAccountId;
      }
      update.parserConfig = await this.parserConfigs.prepareParserConfig({
        organizationId: input.organizationId,
        parserConfig: incoming,
        existing,
      });
    }

    if (input.traceProjectId !== undefined) {
      await this.validation.assertTraceDestination({
        organizationId: input.organizationId,
        traceProjectId: input.traceProjectId,
      });
      update.traceProjectId = input.traceProjectId;
    }

    const source = cursorMustNotMove
      ? await this.updatePinnedToCursor({ existing, update })
      : await this.repository.update(existing.id, update);

    if (existing.pullSchedule !== null || source.pullSchedule !== null) {
      await this.syncBestEffort(source);
    }

    return source;
  }

  /** The fields whose only rule is that they were supplied. */
  private plainUpdateFields(
    input: UpdateGovernanceIngestionSourceCommand,
  ): UpdateIngestionSourceRecord {
    const update: UpdateIngestionSourceRecord = {};
    if (input.name !== undefined) {
      update.name = input.name;
    }

    if (input.description !== undefined) {
      update.description = input.description;
    }

    if (input.status !== undefined) {
      update.status = input.status;
    }

    if (input.teamId !== undefined) {
      update.teamId = input.teamId;
    }

    if (input.pullSchedule !== undefined) {
      update.pullSchedule = input.pullSchedule;
    }

    return update;
  }

  private async updatePinnedToCursor({
    existing,
    update,
  }: {
    existing: GovernanceIngestionSource;
    update: UpdateIngestionSourceRecord;
  }): Promise<GovernanceIngestionSource> {
    const pinned = await this.repository.updateIfCursorUnchanged({
      id: existing.id,
      cursor: existing.pollerCursor,
      update,
    });
    if (pinned.outcome === "cursor_moved") {
      const message =
        "This source started pulling while the change was being saved, and the report " +
        "can no longer be changed. Reload the source to see its current configuration.";

      throw new GovernanceValidationError(message, { formErrors: [message] });
    }

    return pinned.source;
  }

  async rotateSecret({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<{ source: GovernanceIngestionSource; ingestSecret: string }> {
    const existing = await this.getById({ id, organizationId });
    if (!isPushSourceType({ sourceType: existing.sourceType })) {
      throw new GovernanceValidationError(
        "Only push-mode sources have an ingest secret to rotate.",
        { formErrors: ["Only push-mode sources have an ingest secret to rotate."] },
      );
    }

    const ingestSecret = this.secrets.generate();
    const parserConfig = {
      ...existing.parserConfig,
      _rotation: {
        priorHash: existing.ingestSecretHash,
        expiresAt: this.now() + ROTATION_GRACE_MS,
      },
    };
    const source = await this.repository.update(existing.id, {
      ingestSecretHash: this.secrets.hash(ingestSecret),
      parserConfig,
    });

    return { source, ingestSecret };
  }

  async archive({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<GovernanceIngestionSource> {
    const existing = await this.getById({ id, organizationId });
    const source = await this.repository.update(existing.id, {
      archivedAt: Temporal.Instant.fromEpochMilliseconds(this.now()),
      status: "disabled",
    });
    if (source.pullSchedule) {
      await this.syncBestEffort(source);
    }

    return source;
  }

  async recordEventReceived(id: string): Promise<void> {
    await this.repository.update(id, {
      lastEventAt: Temporal.Instant.fromEpochMilliseconds(this.now()),
      status: "active",
    });
  }

  async getById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<GovernanceIngestionSource> {
    const source = await this.findById({ id, organizationId });
    if (!source) {
      throw new IngestionSourceNotFoundError(id);
    }

    return source;
  }

  /**
   * Of the trace destinations these sources point at, the ones that are still live projects of
   * this organization — archived, deleted and never-ours all collapse to "absent", and all
   * three mean the puller has stopped routing.
   */
  async liveTraceProjectIds(
    sources: readonly { traceProjectId?: string | null }[],
    organizationId: string,
  ): Promise<Set<string>> {
    const wanted = [
      ...new Set(sources.map((s) => s.traceProjectId).filter((id): id is string => !!id)),
    ];
    if (wanted.length === 0) {
      return new Set();
    }

    const { data } = await this.projects.listActiveByScopes({
      organizationId,
      organizationWide: false,
      teamIds: [],
      projectIds: wanted,
      limit: wanted.length,
    });

    return new Set(data.map((project) => project.id));
  }

  private async syncBestEffort(source: GovernanceIngestionSource): Promise<void> {
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
