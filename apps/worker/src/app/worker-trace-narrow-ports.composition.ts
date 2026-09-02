import type { MonitorSummary } from "@langwatch/monitor-contract";
import type {
  OrgAdminResolution,
  Project,
  UpdateProjectMetadataInput,
} from "@langwatch/project-contract";
import type { ModelCost } from "@langwatch/model-provider-contract";
import {
  TraceEvaluationMonitorPort,
  TraceModelCostCatalogPort,
  TraceProductAnalyticsPort,
  TraceProjectMetadataPort,
} from "@langwatch/trace-server";

/**
 * The four reads and writes the trace-ingestion subscribers make into other
 * features, each as the narrow port Trace declares.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still owns
 * every one of these subscribers — so nothing in this process reads a monitor
 * or writes a project flag yet. What has to be true today is that this
 * composition root CAN answer all four from published services, without
 * building the fourteen-method `ProjectService`, the fourteen-method
 * `MonitorService` or the whole `ModelProviderService` graph first. That is
 * exactly what blocked the conversion: the subscribers named the services, so
 * a process that wanted one capability had to be able to build all of them.
 *
 * WHAT EACH PARAMETER ASKS FOR IS NOW WHAT EACH ADAPTER CALLS, spelled out
 * below rather than named as a whole service. `ProjectService`,
 * `MonitorService` and `ModelProviderService` each satisfy their parameter,
 * and so do the read-side services their own features publish
 * (`ProjectMetadataService`, `MonitorCatalogService`,
 * `ModelCostCatalogService`) — which is what `createWorkerTraceCapabilityServices`
 * composes and what makes this reachable from a process with a database and
 * nothing else.
 *
 * Each adapter is a rename and nothing else. The published services satisfy the
 * ports structurally — the method names and signatures are identical — so these
 * classes exist to make the direction of the dependency explicit and to give
 * the composition a place to narrow, not to translate anything.
 *
 * THE FOURTH IS SUPPLIED, NOT DEFAULTED. `first_trace_integrated` goes to
 * PostHog in the application and now goes to PostHog from here too; the sink is
 * a required argument because the only thing this composition could default to
 * is a sink that does not deliver, and a caller who forgot to pass one would
 * get silence that reads exactly like a deployment with no key. Compose it with
 * `createWorkerTraceProductAnalytics`.
 */
export function createWorkerTraceNarrowPorts(options: {
  projects: TraceProjectMetadataReader;
  monitors: TraceEvaluationMonitorReader;
  modelProviders: TraceModelCostReader;
  productAnalytics: TraceProductAnalyticsPort;
}): WorkerTraceNarrowPorts {
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
): TraceEvaluationMonitorPort {
  return new WorkerTraceEvaluationMonitorAdapter(monitors);
}

/** The project's own cost rules on their own, for record-time enrichment. */
export function createWorkerTraceModelCostCatalogPort(
  modelProviders: TraceModelCostReader,
): TraceModelCostCatalogPort {
  return new WorkerTraceModelCostCatalogAdapter(modelProviders);
}

/**
 * The three project reads and the one project write the subscribers make.
 *
 * A structural type rather than a service, so the feature's read-side service
 * and its wide sibling both answer it and this file names neither.
 */
export type TraceProjectMetadataReader = {
  tryGetById(id: string): Promise<Project | null>;
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

export type WorkerTraceNarrowPorts = Readonly<{
  projects: TraceProjectMetadataPort;
  monitors: TraceEvaluationMonitorPort;
  modelCosts: TraceModelCostCatalogPort;
  productAnalytics: TraceProductAnalyticsPort;
}>;

class WorkerTraceProjectMetadataAdapter extends TraceProjectMetadataPort {
  constructor(private readonly projects: TraceProjectMetadataReader) {
    super();
  }

  tryGetById(id: string): Promise<Project | null> {
    return this.projects.tryGetById(id);
  }

  updateMetadata(input: UpdateProjectMetadataInput): Promise<void> {
    return this.projects.updateMetadata(input);
  }

  resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution> {
    return this.projects.resolveOrgAdmin(projectId);
  }
}

class WorkerTraceEvaluationMonitorAdapter extends TraceEvaluationMonitorPort {
  constructor(private readonly monitors: TraceEvaluationMonitorReader) {
    super();
  }

  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
    return this.monitors.getEnabledOnMessageMonitors(projectId);
  }
}

class WorkerTraceModelCostCatalogAdapter extends TraceModelCostCatalogPort {
  constructor(private readonly modelProviders: TraceModelCostReader) {
    super();
  }

  listCosts(input: { projectId: string }): Promise<ModelCost[]> {
    return this.modelProviders.listCosts(input);
  }
}
