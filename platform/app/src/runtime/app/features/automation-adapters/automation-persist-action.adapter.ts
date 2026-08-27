import type { AnnotationService } from "@langwatch/annotation-contract";
import type { AutomationService } from "@langwatch/automation-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type {
  TraceCanonicalisationService,
  TraceRecord,
  TraceService,
} from "@langwatch/trace-contract";
import {
  AutomationDatasetMapperPort,
  AutomationPersistActionService,
  AutomationPersistActionWriterPort,
} from "@langwatch/automation-server";
import type { DatasetRecordEntry } from "@langwatch/dataset-contract";
import type { PrismaClient } from "~/generated/prisma/client";
import { createOrUpdateQueueItems } from "~/server/api/routers/annotation";
import { traceSchema } from "~/server/tracer/types";
import { mapTraceToDatasetEntry, TRACE_EXPANSIONS } from "~/server/tracer/tracesMapping";

class AppAutomationDatasetMapper extends AutomationDatasetMapperPort {
  map(input: {
    trace: TraceRecord;
    mapping: Record<
      string,
      { source: string; key?: string; subkey?: string; selectedFields?: string[] }
    >;
    expansions: readonly string[];
  }): Array<Record<string, string | number>> {
    const trace = traceSchema.parse(input.trace);
    const expansions = new Set(
      input.expansions.filter(
        (value): value is keyof typeof TRACE_EXPANSIONS => value in TRACE_EXPANSIONS,
      ),
    );

    return mapTraceToDatasetEntry(trace, input.mapping, expansions);
  }
}

class AppAutomationPersistActionWriter extends AutomationPersistActionWriterPort {
  constructor(
    private readonly database: PrismaClient,
    private readonly annotations: AnnotationService,
    private readonly traceCanonicalisation: TraceCanonicalisationService,
    private readonly dataset: DatasetService,
  ) {
    super();
  }

  async addToAnnotationQueue(input: {
    traceIds: string[];
    projectId: string;
    annotators: string[];
    userId: string;
  }): Promise<void> {
    await createOrUpdateQueueItems({
      ...input,
      prisma: this.database,
      annotations: this.annotations,
      traceCanonicalisation: this.traceCanonicalisation,
    });
  }

  async addToDataset(input: {
    datasetId: string;
    projectId: string;
    datasetRecords: DatasetRecordEntry[];
  }): Promise<void> {
    await this.dataset.batchCreateRecords({
      slugOrId: input.datasetId,
      projectId: input.projectId,
      entries: input.datasetRecords,
    });
  }
}

export class AppAutomationPersistActionAdapter {
  static create(input: {
    database: PrismaClient;
    automation: AutomationService;
    projects: ProjectService;
    traces: TraceService;
    annotations: AnnotationService;
    traceCanonicalisation: TraceCanonicalisationService;
    dataset: DatasetService;
  }): AutomationPersistActionService {
    return AutomationPersistActionService.create({
      automation: input.automation,
      projects: input.projects,
      traces: input.traces,
      mapper: new AppAutomationDatasetMapper(),
      writer: new AppAutomationPersistActionWriter(
        input.database,
        input.annotations,
        input.traceCanonicalisation,
        input.dataset,
      ),
    });
  }
}
