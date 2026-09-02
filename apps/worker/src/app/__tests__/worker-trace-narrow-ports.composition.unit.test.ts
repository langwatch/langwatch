import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  TraceEvaluationMonitorPort,
  TraceModelCostCatalogPort,
  TraceProductAnalyticsPort,
  TraceProjectMetadataPort,
  type TraceProductEvent,
} from "@langwatch/trace-server";
import { describe, expect, it, vi } from "vitest";
import { createWorkerTraceProductAnalytics } from "../worker-trace-product-analytics.composition";
import { createWorkerTraceNarrowPorts } from "../worker-trace-narrow-ports.composition";

/**
 * Spec: packages/features/trace/specs/trace-ingestion-narrow-ports.feature
 *
 * A COMPOSITION-CAPABILITY test. Trace has not converted, so none of these
 * subscribers runs here. What has to be true today is that this composition
 * root can answer all four narrow ports from published services, and that each
 * port really does reach the capability it names — the ports are the whole
 * point of the slice, so a test that exercised the services directly would
 * prove nothing about them.
 */

const project = { id: "project-1", firstMessage: false, integrated: false };

function services(): {
  projects: ProjectService;
  monitors: MonitorService;
  modelProviders: ModelProviderService;
  calls: {
    tryGetById: ReturnType<typeof vi.fn>;
    updateMetadata: ReturnType<typeof vi.fn>;
    resolveOrgAdmin: ReturnType<typeof vi.fn>;
    getEnabledOnMessageMonitors: ReturnType<typeof vi.fn>;
    listCosts: ReturnType<typeof vi.fn>;
  };
} {
  const calls = {
    tryGetById: vi.fn(async () => project),
    updateMetadata: vi.fn(async () => void 0),
    resolveOrgAdmin: vi.fn(async () => ({ userId: "user-1" })),
    getEnabledOnMessageMonitors: vi.fn(async () => [
      { id: "check-1", checkType: "custom", name: "One", threadIdleTimeout: null, evaluator: null },
    ]),
    listCosts: vi.fn(async () => [{ id: "cost-1", model: "gpt-5-mini", regex: "^gpt-5" }]),
  };
  return {
    projects: calls as unknown as ProjectService,
    monitors: calls as unknown as MonitorService,
    modelProviders: calls as unknown as ModelProviderService,
    calls,
  };
}

describe("createWorkerTraceNarrowPorts", () => {
  describe("given the published services", () => {
    describe("when the four narrow ports are composed", () => {
      /** @scenario "The published project service still satisfies the narrowed port" */
      it("answers each port as the port it declares", () => {
        const { projects, monitors, modelProviders } = services();
        const productAnalytics = createWorkerTraceProductAnalytics({ config: {} });

        const ports = createWorkerTraceNarrowPorts({
          projects,
          monitors,
          modelProviders,
          productAnalytics,
        });

        expect(ports.projects).toBeInstanceOf(TraceProjectMetadataPort);
        expect(ports.monitors).toBeInstanceOf(TraceEvaluationMonitorPort);
        expect(ports.modelCosts).toBeInstanceOf(TraceModelCostCatalogPort);
        expect(ports.productAnalytics).toBeInstanceOf(TraceProductAnalyticsPort);
      });

      /** @scenario "The project metadata subscriber names three capabilities, not a service" */
      it("reaches all three project capabilities through the one port", async () => {
        const { projects, monitors, modelProviders, calls } = services();
        const productAnalytics = createWorkerTraceProductAnalytics({ config: {} });
        const ports = createWorkerTraceNarrowPorts({
          projects,
          monitors,
          modelProviders,
          productAnalytics,
        });

        await ports.projects.tryGetById("project-1");
        await ports.projects.updateMetadata({
          id: "project-1",
          data: { firstMessage: true, integrated: true, language: "python" },
        });
        await ports.projects.resolveOrgAdmin("project-1");

        expect(calls.tryGetById).toHaveBeenCalledWith("project-1");
        expect(calls.updateMetadata).toHaveBeenCalledWith({
          id: "project-1",
          data: { firstMessage: true, integrated: true, language: "python" },
        });
        expect(calls.resolveOrgAdmin).toHaveBeenCalledWith("project-1");
      });

      /** @scenario "The evaluation trigger names one monitor read" */
      it("lists the project's on-message monitors through the port", async () => {
        const { projects, monitors, modelProviders, calls } = services();
        const productAnalytics = createWorkerTraceProductAnalytics({ config: {} });
        const ports = createWorkerTraceNarrowPorts({
          projects,
          monitors,
          modelProviders,
          productAnalytics,
        });

        await expect(ports.monitors.getEnabledOnMessageMonitors("project-1")).resolves.toEqual([
          {
            id: "check-1",
            checkType: "custom",
            name: "One",
            threadIdleTimeout: null,
            evaluator: null,
          },
        ]);
        expect(calls.getEnabledOnMessageMonitors).toHaveBeenCalledWith("project-1");
      });

      /** @scenario "Record-time cost enrichment reads the project's own cost rules" */
      it("reads the project's own cost rules through the port", async () => {
        const { projects, monitors, modelProviders, calls } = services();
        const productAnalytics = createWorkerTraceProductAnalytics({ config: {} });
        const ports = createWorkerTraceNarrowPorts({
          projects,
          monitors,
          modelProviders,
          productAnalytics,
        });

        await ports.modelCosts.listCosts({ projectId: "project-1" });

        expect(calls.listCosts).toHaveBeenCalledWith({ projectId: "project-1" });
      });
    });
  });

  describe("given a composed product-analytics sink", () => {
    describe("when the first-trace milestone is recorded", () => {
      /** @scenario "The first-trace milestone is recorded through a sink, not a function" */
      it("hands the milestone to the sink it was composed with", () => {
        const { projects, monitors, modelProviders } = services();
        const recorded: TraceProductEvent[] = [];
        const productAnalytics = new (class extends TraceProductAnalyticsPort {
          record(event: TraceProductEvent): void {
            recorded.push(event);
          }
        })();

        createWorkerTraceNarrowPorts({
          projects,
          monitors,
          modelProviders,
          productAnalytics,
        }).productAnalytics.record({
          userId: "user-1",
          event: "first_trace_integrated",
          properties: { sdk_language: "python", sdk_framework: "unknown" },
          projectId: "project-1",
        });

        expect(recorded).toEqual([
          {
            userId: "user-1",
            event: "first_trace_integrated",
            properties: { sdk_language: "python", sdk_framework: "unknown" },
            projectId: "project-1",
          },
        ]);
      });
    });
  });
});
