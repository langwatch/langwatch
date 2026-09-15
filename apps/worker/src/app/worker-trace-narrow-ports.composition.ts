import type { MonitorSummary } from "@langwatch/monitor-contract";
import type {
  OrgAdminResolution,
  Project,
  UpdateProjectMetadataInput,
} from "@langwatch/project-contract";
import type { ModelCost } from "@langwatch/model-provider-contract";
import {
  type TraceEvaluationMonitor,
  type TraceModelCostCatalog,
  type TraceProductAnalytics,
  type TraceProjectMetadata,
} from "@langwatch/trace-server";

/**
 * Staged but not mounted; answers the four subscriber ports from published
 * read-side services.
 */
export function createWorkerTraceNarrowPorts(options: {
  projects: TraceProjectMetadataReader;
  monitors: TraceEvaluationMonitorReader;
  modelProviders: TraceModelCostReader;
  productAnalytics: TraceProductAnalytics;
}): WorkerTraceNarrowMembers {
  return {
    projects: new WorkerTraceProjectMetadataAdapter(options.projects),
    monitors: createWorkerTraceEvaluationMonitorPort(options.monitors),
    modelCosts: createWorkerTraceModelCostCatalogPort(options.modelProviders),
    productAnalytics: options.productAnalytics,
  };
}

/**
 * The monitor listing on its own.
 *
 * The evaluation trigger is the only caller of this read and needs none of the
 * other three, so it composes this rather than a four-port bundle it would
 * have to satisfy with placeholders. Same adapter either way — there is one
 * rename of `getEnabledOnMessageMonitors`, not two.
 */
export function createWorkerTraceEvaluationMonitorPort(
  monitors: TraceEvaluationMonitorReader,
): TraceEvaluationMonitor {
  return new WorkerTraceEvaluationMonitorAdapter(monitors);
}

/** The project's own cost rules on their own, for record-time enrichment. */
export function createWorkerTraceModelCostCatalogPort(
  modelProviders: TraceModelCostReader,
): TraceModelCostCatalog {
  return new WorkerTraceModelCostCatalogAdapter(modelProviders);
}

/**
 * The three project reads and the one project write the subscribers make.
 *
 * A structural type rather than a service, so the feature's read-side service
 * and its wide sibling both answer it and this file names neither.
 */
export type TraceProjectMetadataReader = {
  findById(id: string): Promise<Project | null>;
  updateMetadata(input: UpdateProjectMetadataInput): Promise<void>;
  resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution>;
};

/** The one monitor listing the evaluation trigger reads. */
export type TraceEvaluationMonitorReader = {
  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]>;
};

/** The one cost listing record-time enrichment reads. */
export type TraceModelCostReader = {
  listCosts(input: { projectId: string }): Promise<ModelCost[]>;
};

export type WorkerTraceNarrowMembers = Readonly<{
  projects: TraceProjectMetadata;
  monitors: TraceEvaluationMonitor;
  modelCosts: TraceModelCostCatalog;
  productAnalytics: TraceProductAnalytics;
}>;

class WorkerTraceProjectMetadataAdapter implements TraceProjectMetadata {
  constructor(private readonly projects: TraceProjectMetadataReader) {}

  findById(id: string): Promise<Project | null> {
    return this.projects.findById(id);
  }

  updateMetadata(input: UpdateProjectMetadataInput): Promise<void> {
    return this.projects.updateMetadata(input);
  }

  resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution> {
    return this.projects.resolveOrgAdmin(projectId);
  }
}

class WorkerTraceEvaluationMonitorAdapter implements TraceEvaluationMonitor {
  constructor(private readonly monitors: TraceEvaluationMonitorReader) {}

  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
    return this.monitors.getEnabledOnMessageMonitors(projectId);
  }
}

class WorkerTraceModelCostCatalogAdapter implements TraceModelCostCatalog {
  constructor(private readonly modelProviders: TraceModelCostReader) {}

  listCosts(input: { projectId: string }): Promise<ModelCost[]> {
    return this.modelProviders.listCosts(input);
  }
}
