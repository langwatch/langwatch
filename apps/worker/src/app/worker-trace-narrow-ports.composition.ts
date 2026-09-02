import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { MonitorService, MonitorSummary } from "@langwatch/monitor-contract";
import type { Logger } from "@langwatch/observability";
import type {
  OrgAdminResolution,
  Project,
  ProjectService,
  UpdateProjectMetadataInput,
} from "@langwatch/project-contract";
import type { ModelCost } from "@langwatch/model-provider-contract";
import {
  TraceEvaluationMonitorPort,
  TraceModelCostCatalogPort,
  TraceProductAnalyticsPort,
  TraceProjectMetadataPort,
} from "@langwatch/trace-server";
import { WorkerLoggedProductAnalyticsAdapter } from "../platform/infrastructure/worker-product-analytics.adapter";

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
 * Each adapter is a rename and nothing else. The published services satisfy the
 * ports structurally — the method names and signatures are identical — so these
 * classes exist to make the direction of the dependency explicit and to give
 * the composition a place to narrow, not to translate anything.
 *
 * THE FOURTH IS A NAMED ABSENCE. `first_trace_integrated` goes to PostHog in
 * the application and this process has no PostHog; see
 * `WorkerLoggedProductAnalyticsAdapter`.
 */
export function createWorkerTraceNarrowPorts(options: {
  projects: ProjectService;
  monitors: MonitorService;
  modelProviders: ModelProviderService;
  productAnalytics?: TraceProductAnalyticsPort;
  logger?: Logger;
}): WorkerTraceNarrowPorts {
  return {
    projects: new WorkerTraceProjectMetadataAdapter(options.projects),
    monitors: new WorkerTraceEvaluationMonitorAdapter(options.monitors),
    modelCosts: new WorkerTraceModelCostCatalogAdapter(options.modelProviders),
    productAnalytics:
      options.productAnalytics ?? WorkerLoggedProductAnalyticsAdapter.create(options.logger),
  };
}

export type WorkerTraceNarrowPorts = Readonly<{
  projects: TraceProjectMetadataPort;
  monitors: TraceEvaluationMonitorPort;
  modelCosts: TraceModelCostCatalogPort;
  productAnalytics: TraceProductAnalyticsPort;
}>;

class WorkerTraceProjectMetadataAdapter extends TraceProjectMetadataPort {
  constructor(private readonly projects: ProjectService) {
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
  constructor(private readonly monitors: MonitorService) {
    super();
  }

  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
    return this.monitors.getEnabledOnMessageMonitors(projectId);
  }
}

class WorkerTraceModelCostCatalogAdapter extends TraceModelCostCatalogPort {
  constructor(private readonly modelProviders: ModelProviderService) {
    super();
  }

  listCosts(input: { projectId: string }): Promise<ModelCost[]> {
    return this.modelProviders.listCosts(input);
  }
}
