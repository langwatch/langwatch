import {
  GOVERNANCE_INGESTION_SOURCE_TYPES,
  GovernanceValidationError,
  isPushSourceType,
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
import { PROJECT_KIND, type ProjectService } from "@langwatch/project-contract";
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
import { hasPollerCursor } from "../adapters/poller-cursor.adapter";

const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

export class IngestionSourceService {
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
  ) {}

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

  async tryFindById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<GovernanceIngestionSource | null> {
    const row = await this.repository.tryFindById(id);
    return row?.organizationId === organizationId ? row : null;
  }

  async tryFindByIngestSecret(rawSecret: string): Promise<GovernanceIngestionSource | null> {
    const candidateHash = this.secrets.hash(rawSecret);
    const direct = await this.repository.tryFindByCurrentSecretHash(candidateHash);
    if (direct) return direct;

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
    this.assertPullSchedule(input.pullSchedule);
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
      ...(input.pullConfig ?? {}),
      ...(input.parserConfig ?? {}),
    };
    this.destinations.assertAllowed(requestedParserConfig);
    await this.assertTraceDestination({
      organizationId: input.organizationId,
      traceProjectId: input.traceProjectId,
    });
    const parserConfig = this.credentials.tryEncryptParserConfig(requestedParserConfig) ?? {};
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
    });
    if (source.pullSchedule) await this.syncBestEffort(source);
    return { source, ingestSecret };
  }

  async updateSource(
    input: UpdateGovernanceIngestionSourceCommand,
  ): Promise<GovernanceIngestionSource> {
    const existing = await this.getById({ id: input.id, organizationId: input.organizationId });
    this.assertPullSchedule(input.pullSchedule);
    const update: UpdateIngestionSourceRecord = {};
    let cursorMustNotMove = false;
    if (input.name !== undefined) update.name = input.name;
    if (input.description !== undefined) update.description = input.description;
    if (input.status !== undefined) update.status = input.status;
    if (input.teamId !== undefined) update.teamId = input.teamId;
    if (input.traceProjectId !== undefined) {
      await this.assertTraceDestination({
        organizationId: input.organizationId,
        traceProjectId: input.traceProjectId,
      });
      update.traceProjectId = input.traceProjectId;
    }
    if (input.pullSchedule !== undefined) update.pullSchedule = input.pullSchedule;
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
          (key === "credentials" ||
            key === "adapter" ||
            key === "schedule" ||
            key.startsWith("_")) &&
          incoming[key] === undefined
        ) {
          incoming[key] = existing.parserConfig[key];
        }
      }
      this.assertAdapterUnchanged(existing.parserConfig, incoming);
      cursorMustNotMove = this.assertReportUnchangedOncePulled(existing, incoming);
      this.destinations.assertAllowed(incoming);
      update.parserConfig = this.credentials.tryEncryptParserConfig(incoming) ?? incoming;
    }

    const source = cursorMustNotMove
      ? await this.repository.tryUpdateIfCursorUnchanged({
          id: existing.id,
          cursor: existing.pollerCursor,
          update,
        })
      : await this.repository.update(existing.id, update);
    if (source === null) {
      const message =
        "This source started pulling while the change was being saved, and the report " +
        "can no longer be changed. Reload the source to see its current configuration.";
      throw new GovernanceValidationError(message, { formErrors: [message] });
    }
    if (existing.pullSchedule !== null || source.pullSchedule !== null) {
      await this.syncBestEffort(source);
    }
    return source;
  }

  async rotateSecret({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<CreatedGovernanceIngestionSource> {
    const existing = await this.getById({ id, organizationId });
    if (!isPushSourceType({ sourceType: existing.sourceType })) {
      throw new GovernanceValidationError(
        "Only push-mode sources have an ingest secret to rotate.",
        { formErrors: ["Only push-mode sources have an ingest secret to rotate."] },
      );
    }
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

  async archive({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<GovernanceIngestionSource> {
    const existing = await this.getById({ id, organizationId });
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

  async getById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<GovernanceIngestionSource> {
    const source = await this.tryFindById({ id, organizationId });
    if (!source) throw new IngestionSourceNotFoundError(id);
    return source;
  }

  /**
   * Of the trace destinations these sources point at, the ones that are still
   * live projects of this organization — archived, deleted and never-ours all
   * collapse to "absent", and all three mean the puller has stopped routing.
   *
   * The presentation layer needs the complement: a destination missing from
   * this set has stopped routing, and an admin has to be told that rather than
   * shown an empty picker. It cannot work that out from the project list it
   * already has, because a project outside the reader's own teams is also
   * absent from that list and is not archived at all.
   *
   * One query for the whole page, keyed on the ids actually in use, so listing
   * sources never becomes a per-row lookup.
   */
  async liveTraceProjectIds(
    sources: ReadonlyArray<{ traceProjectId?: string | null }>,
    organizationId: string,
  ): Promise<Set<string>> {
    const wanted = [
      ...new Set(sources.map((s) => s.traceProjectId).filter((id): id is string => !!id)),
    ];
    if (wanted.length === 0) return new Set();

    const { data } = await this.projects.listActiveByScopes({
      organizationId,
      organizationWide: false,
      teamIds: [],
      projectIds: wanted,
      limit: wanted.length,
    });
    return new Set(data.map((project) => project.id));
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

  private assertAdapterUnchanged(
    stored: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): void {
    const adapter = stored.adapter;
    if (typeof adapter !== "string") return;
    if (incoming.adapter === adapter) return;

    const message =
      `This source runs on the ${adapter} adapter, which is fixed when the source is created. ` +
      "Archive this source and create a new one to change how it pulls.";
    throw new GovernanceValidationError(message, { formErrors: [message] });
  }

  private assertReportUnchangedOncePulled(
    existing: GovernanceIngestionSource,
    incoming: Record<string, unknown>,
  ): boolean {
    const report = existing.parserConfig.report;
    if (typeof report !== "string" || incoming.report === report) return false;
    if (!hasPollerCursor(existing.pollerCursor)) return true;

    const message =
      incoming.report === undefined
        ? `This source is configured for its ${report} report, and has already pulled it. ` +
          "An update that replaces the configuration has to carry the same report value rather than omit it."
        : `This source has already pulled its ${report} report. ` +
          "Changing the report would record the same spend a second time, so it is fixed once a source has run.";
    throw new GovernanceValidationError(message, { formErrors: [message] });
  }

  private async assertTraceDestination(input: {
    organizationId: string;
    traceProjectId: string | null | undefined;
  }): Promise<void> {
    if (!input.traceProjectId) return;

    const project = await this.projects.tryGetWithTeam(input.traceProjectId);
    const isAllowed =
      project !== null &&
      project.archivedAt === null &&
      project.team.organizationId === input.organizationId;
    if (isAllowed) return;

    const message = "Trace destination must be an active project of this organization.";
    throw new GovernanceValidationError(message, { formErrors: [message] });
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
