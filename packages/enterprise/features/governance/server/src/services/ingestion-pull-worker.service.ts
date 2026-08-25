import type {
  GovernanceIngestionSource,
  NormalizedPullEvent,
  PullResult,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND, type ProjectService } from "@langwatch/project-contract";
import type {
  GovernanceOcsfEventInput,
  GovernanceOcsfEventSinkPort,
  IngestionPullDiagnosticsPort,
  IngestionPullSourcePort,
  PulledUsageDispatcherPort,
  PulledUsageEntitlementPort,
} from "../ports/ingestion-pull-worker.port";
import type { IngestionCredentialsService } from "./ingestion-credentials.service";
import type { PulledUsageRecordService } from "./pulled-usage-record.service";
import type { PullerRegistryService } from "./puller-registry.service";

const OCSF_CLASS_API_ACTIVITY = 6003;
const OCSF_CATEGORY_APPLICATION_ACTIVITY = 6;
const OCSF_ACTIVITY_INVOKE = 6;
const OCSF_SEVERITY_INFO = 1;

export class IngestionPullDeadlineExceededError extends Error {
  constructor(deadlineMs: number) {
    super(`Ingestion pull exceeded its ${deadlineMs}ms deadline`);
    this.name = "IngestionPullDeadlineExceededError";
  }
}

export class IngestionPullWorkerConfiguration {
  private constructor(readonly deadlineMs: number) {}

  static create(
    input: {
      deadlineMs?: number;
    } = {},
  ): IngestionPullWorkerConfiguration {
    return new IngestionPullWorkerConfiguration(input.deadlineMs ?? 5 * 60 * 1000);
  }
}

export class IngestionPullWorkerService {
  private constructor(
    private readonly sources: IngestionPullSourcePort,
    private readonly registry: PullerRegistryService,
    private readonly credentials: IngestionCredentialsService,
    private readonly projects: ProjectService,
    private readonly sink: GovernanceOcsfEventSinkPort,
    private readonly usageEntitlement: PulledUsageEntitlementPort,
    private readonly usageRecords: PulledUsageRecordService,
    private readonly diagnostics: IngestionPullDiagnosticsPort,
    private readonly configuration: IngestionPullWorkerConfiguration,
    private readonly now: () => number,
  ) {}

  static create(options: {
    sources: IngestionPullSourcePort;
    registry: PullerRegistryService;
    credentials: IngestionCredentialsService;
    projects: ProjectService;
    sink: GovernanceOcsfEventSinkPort;
    usageEntitlement: PulledUsageEntitlementPort;
    usageRecords: PulledUsageRecordService;
    diagnostics: IngestionPullDiagnosticsPort;
    configuration?: IngestionPullWorkerConfiguration;
    now?: () => number;
  }): IngestionPullWorkerService {
    return new IngestionPullWorkerService(
      options.sources,
      options.registry,
      options.credentials,
      options.projects,
      options.sink,
      options.usageEntitlement,
      options.usageRecords,
      options.diagnostics,
      options.configuration ?? IngestionPullWorkerConfiguration.create(),
      options.now ?? Date.now,
    );
  }

  async run(input: {
    sourceId: string;
    cursor: string | null;
    pulledUsage?: PulledUsageDispatcherPort;
  }): Promise<{ nextCursor: string | null; eventCount: number }> {
    const source = await this.sources.tryFindById(input.sourceId);
    if (!source) {
      throw new Error(`IngestionSource ${input.sourceId} not found`);
    }
    if (source.status !== "active" && source.status !== "awaiting_first_event") {
      this.diagnostics.info("IngestionSource not active, skipping", {
        ingestionSourceId: source.id,
        status: source.status,
      });
      return { nextCursor: input.cursor, eventCount: 0 };
    }

    const pullConfig = source.parserConfig;
    const adapterId = pullConfig.adapter;
    if (typeof adapterId !== "string") {
      throw new Error("IngestionSource has no pullConfig.adapter");
    }
    const adapter = this.registry.tryGet(adapterId);
    if (!adapter) {
      throw new Error(`Unknown ingestion pull adapter: ${adapterId}`);
    }
    const validatedConfig = adapter.validateConfig(pullConfig);

    let result: PullResult;
    try {
      result = await this.withDeadline((signal, deadlineAt) =>
        adapter.runOnce(
          {
            cursor: input.cursor,
            credentials: this.credentials.decrypt(pullConfig.credentials),
            context: {
              organizationId: source.organizationId,
              ingestionSourceId: source.id,
            },
            deadlineMs: deadlineAt,
            signal,
          },
          validatedConfig,
        ),
      );
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.diagnostics.error(
        "adapter.runOnce threw — leaving the durable cursor unchanged",
        { ingestionSourceId: source.id, adapterId, error: normalized.message },
      );
      this.diagnostics.capture(normalized, {
        worker: "ingestionPuller",
        ingestionSourceId: source.id,
      });
      throw error;
    }

    if (result.errorCount > 0) {
      throw new Error(`Ingestion pull adapter reported ${result.errorCount} error(s)`);
    }

    if (result.events.length > 0) {
      await this.writeEvents({
        events: result.events,
        source,
        pulledUsage: input.pulledUsage,
      });
    }
    return { nextCursor: result.cursor, eventCount: result.events.length };
  }

  private async withDeadline<T>(
    work: (signal: AbortSignal, deadlineAt: number) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = this.configuration.deadlineMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await Promise.race([
        work(controller.signal, this.now() + timeoutMs),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(new IngestionPullDeadlineExceededError(timeoutMs)),
            { once: true },
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async writeEvents(input: {
    events: NormalizedPullEvent[];
    source: GovernanceIngestionSource;
    pulledUsage?: PulledUsageDispatcherPort;
  }): Promise<void> {
    const project = await this.projects.ensureInternal({
      organizationId: input.source.organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    const recordCost = await this.usageEntitlement.isEnabled(input.source.organizationId);
    const observedAt = new Date(this.now());
    for (const event of input.events) {
      await this.sink.insertEvent(
        this.toOcsfRow({
          event,
          tenantId: project.id,
          ingestionSourceId: input.source.id,
          sourceType: input.source.sourceType,
        }),
      );
      if (!recordCost || !input.pulledUsage) continue;
      let record: ReturnType<PulledUsageRecordService["tryBuild"]>;
      try {
        record = this.usageRecords.tryBuild({
          event,
          source: {
            ingestionSourceId: input.source.id,
            sourceType: input.source.sourceType,
            organizationId: input.source.organizationId,
            teamId: input.source.teamId,
          },
          observedAt,
        });
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.diagnostics.error(
          "could not map a pulled item to a usage record; the audit row landed but this item has no price",
          {
            ingestionSourceId: input.source.id,
            sourceEventId: event.source_event_id,
            error: normalized.message,
          },
        );
        this.diagnostics.capture(normalized, {
          worker: "ingestionPuller",
          ingestionSourceId: input.source.id,
        });
        continue;
      }
      if (!record) continue;
      await input.pulledUsage.recordPulledUsage({
        ...record,
        tenantId: project.id,
        occurredAt: record.occurredAtMs,
      });
    }
  }

  private toOcsfRow(input: {
    event: NormalizedPullEvent;
    tenantId: string;
    ingestionSourceId: string;
    sourceType: string;
  }): GovernanceOcsfEventInput {
    const parsedTime = new Date(input.event.event_timestamp);
    const eventTime = Number.isFinite(parsedTime.getTime())
      ? parsedTime
      : new Date(this.now());
    const eventId = `${input.sourceType}:${input.ingestionSourceId}:${input.event.source_event_id}`;
    const rawOcsfJson = JSON.stringify({
      class_uid: OCSF_CLASS_API_ACTIVITY,
      category_uid: OCSF_CATEGORY_APPLICATION_ACTIVITY,
      activity_id: OCSF_ACTIVITY_INVOKE,
      type_uid: OCSF_CLASS_API_ACTIVITY * 100 + OCSF_ACTIVITY_INVOKE,
      severity_id: OCSF_SEVERITY_INFO,
      time: eventTime.getTime(),
      actor: {
        user: { uid: "", email_addr: input.event.actor },
        enduser: { uid: "" },
      },
      api: { operation: input.event.action },
      dst_endpoint: { name: input.event.target },
      metadata: {
        product: { name: "LangWatch", vendor_name: "LangWatch" },
        extension: {
          uid: "langwatch.governance",
          source_type: input.sourceType,
          source_id: input.ingestionSourceId,
          ingest_mode: "pull",
          cost_usd: input.event.cost_usd,
          tokens_input: input.event.tokens_input,
          tokens_output: input.event.tokens_output,
          raw_event: input.event.raw_payload,
          ...(input.event.extra ?? {}),
        },
      },
    });
    return {
      tenantId: input.tenantId,
      eventId,
      traceId: `pull:${eventId}`,
      sourceId: input.ingestionSourceId,
      sourceType: input.sourceType,
      activityId: OCSF_ACTIVITY_INVOKE,
      severityId: OCSF_SEVERITY_INFO,
      eventTime,
      actorUserId: "",
      actorEmail: input.event.actor,
      actorEnduserId: "",
      actionName: input.event.action,
      targetName: input.event.target,
      anomalyAlertId: "",
      rawOcsfJson,
    };
  }
}
