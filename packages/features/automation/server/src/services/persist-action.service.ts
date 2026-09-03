import {
  annotationQueueActionParamsSchema,
  datasetActionParamsSchema,
  NOTIFY_TRIGGER_ACTIONS,
  PERSIST_TRIGGER_ACTIONS,
  type TriggerSummary,
} from "@langwatch/automation-contract";
import { TraceNotFoundError, type TraceRecord } from "@langwatch/trace-contract";
import { DispatchError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { AutomationProjectIdentityPort } from "../ports/automation-graph-activity.port";
import {
  AutomationDatasetMapperPort,
  AutomationPersistActionWriterPort,
} from "../ports/automation-persist-action.port";
import type { AutomationSettlementLedgerPort } from "../ports/automation-settlement-ledger.port";
import type { AutomationSettlementTraceReaderPort } from "../ports/automation-settlement-read.port";

/** The project read this path makes: an existence check, and nothing else. */
type PersistActionProject = { id: string; name: string; slug: string };

const logger = createLogger("langwatch:automation:persist-action");

function sanitizeRecord(record: Record<string, string | number>): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === "string" ? value.replaceAll("\u0000", "") : value,
    ]),
  );
}

/** Owns the persist-class trigger actions. Host code supplies only complete
 * project/trace services and named write/mapping ports. */
export class AutomationPersistActionService {
  private constructor(
    private readonly automation: AutomationSettlementLedgerPort,
    private readonly projects: AutomationProjectIdentityPort,
    private readonly traces: AutomationSettlementTraceReaderPort,
    private readonly mapper: AutomationDatasetMapperPort,
    private readonly writer: AutomationPersistActionWriterPort,
  ) {}

  static create(input: {
    automation: AutomationSettlementLedgerPort;
    projects: AutomationProjectIdentityPort;
    traces: AutomationSettlementTraceReaderPort;
    mapper: AutomationDatasetMapperPort;
    writer: AutomationPersistActionWriterPort;
  }): AutomationPersistActionService {
    return new AutomationPersistActionService(
      input.automation,
      input.projects,
      input.traces,
      input.mapper,
      input.writer,
    );
  }

  async dispatch(input: {
    trigger: TriggerSummary;
    traceId: string;
    tenantId: string;
    project?: PersistActionProject;
  }): Promise<void> {
    const { trigger, traceId, tenantId } = input;
    const project = input.project ?? (await this.projects.tryGetById(tenantId));
    if (!project) {
      logger.warn({ tenantId, triggerId: trigger.id }, "Project not found");

      return;
    }

    if (NOTIFY_TRIGGER_ACTIONS.has(trigger.action)) {
      throw new DispatchError({
        message: `persist action cannot dispatch notify action ${trigger.action} inline — notify actions ride the outbox (trigger ${trigger.id})`,
        retryable: false,
      });
    }

    if (!PERSIST_TRIGGER_ACTIONS.has(trigger.action)) {
      throw new DispatchError({
        message: `Unsupported Automation action ${trigger.action} for trigger ${trigger.id}`,
        retryable: false,
      });
    }

    const params = trigger.actionParams;
    let dispatched = true;
    if (trigger.action === "ADD_TO_ANNOTATION_QUEUE") {
      const parsed = annotationQueueActionParamsSchema.safeParse(params);
      if (!parsed.success || !parsed.data.createdByUserId) {
        logger.warn(
          { tenantId, triggerId: trigger.id },
          "ADD_TO_ANNOTATION_QUEUE trigger missing createdByUserId; skipping action",
        );

        return;
      }

      await this.writer.addToAnnotationQueue({
        traceIds: [traceId],
        projectId: tenantId,
        annotators: parsed.data.annotators.map(({ id }) => id),
        userId: parsed.data.createdByUserId,
      });
    } else {
      dispatched = await this.dispatchToDataset({ trigger, traceId, tenantId, params });
    }

    if (!dispatched) {
      return;
    }

    await this.automation.updateLastRunAt({
      triggerId: trigger.id,
      projectId: tenantId,
    });
    logger.info(
      { tenantId, traceId, triggerId: trigger.id, action: trigger.action },
      "Trigger fired",
    );
  }

  private async dispatchToDataset(input: {
    trigger: TriggerSummary;
    traceId: string;
    tenantId: string;
    params: Record<string, unknown>;
  }): Promise<boolean> {
    const parsed = datasetActionParamsSchema.safeParse(input.params);
    if (!parsed.success) {
      logger.warn(
        { tenantId: input.tenantId, triggerId: input.trigger.id },
        "ADD_TO_DATASET trigger missing datasetId or datasetMapping",
      );

      return false;
    }

    let fullTrace: TraceRecord;
    try {
      fullTrace = await this.traces.getById({
        projectId: input.tenantId,
        traceId: input.traceId,
      });
    } catch (error) {
      if (!(error instanceof TraceNotFoundError)) {
        throw error;
      }

      logger.warn(
        { tenantId: input.tenantId, traceId: input.traceId, triggerId: input.trigger.id },
        "Trace not found for ADD_TO_DATASET action",
      );

      return false;
    }

    if (fullTrace.spans.length === 0) {
      logger.warn(
        { tenantId: input.tenantId, traceId: input.traceId, triggerId: input.trigger.id },
        "Trace has no spans for ADD_TO_DATASET action",
      );

      return false;
    }

    const mappedEntries = this.mapper.map({
      trace: fullTrace,
      mapping: parsed.data.datasetMapping.mapping,
      expansions: parsed.data.datasetMapping.expansions,
    });
    const datasetRecords = mappedEntries.map((entry, index) => ({
      id: `${input.trigger.id}-${input.traceId}-${index}`,
      selected: true,
      ...sanitizeRecord(entry),
    }));
    await this.writer.addToDataset({
      datasetId: parsed.data.datasetId,
      projectId: input.tenantId,
      datasetRecords,
    });

    return true;
  }
}
