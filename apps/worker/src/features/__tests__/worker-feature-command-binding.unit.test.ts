import { describe, expect, it, vi } from "vitest";

import { BillingReportingWorkerFeatureInstaller } from "../billing/billing-reporting-worker-feature.installer";
import { CodingAgentWorkerFeatureInstaller } from "../coding-agent/coding-agent-worker-feature.installer";
import { EvaluationWorkerFeatureInstaller } from "../evaluation/evaluation-worker-feature.installer";
import { ExperimentWorkerFeatureInstaller } from "../experiment/experiment-worker-feature.installer";
import { GatewaySpendWorkerFeatureInstaller } from "../gateway/gateway-spend-worker-feature.installer";
import { GovernanceEventsWorkerFeatureInstaller } from "../governance/governance-events-worker-feature.installer";
import { GovernanceIngestionWorkerFeatureInstaller } from "../governance/governance-ingestion-worker-feature.installer";
import { ScenarioWorkerFeatureInstaller } from "../scenario/scenario-worker-feature.installer";
import { SuiteWorkerFeatureInstaller } from "../suite/suite-worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/**
 * A registration surface, not a runtime. These installers do exactly one thing
 * with the Eventing runtime — register a definition and read back its command
 * senders — so a stub that records what was registered characterises them
 * without booting a queue.
 */
function eventingStub(commandNames: readonly string[], options?: { queue?: boolean }) {
  const sent = new Map<string, unknown[]>();
  const registeredJobs: { name: string; delay?: number }[] = [];
  const definitions: unknown[] = [];
  const commands = Object.fromEntries(
    commandNames.map((name) => [
      name,
      {
        send: async (data: unknown) => {
          sent.set(name, [...(sent.get(name) ?? []), data]);
        },
      },
    ]),
  );
  const runtime = {
    eventSourcing: {
      register: (definition: unknown) => {
        definitions.push(definition);
        return {
          commands,
          service: {
            registerJob: (config: { name: string; delay?: number }) => {
              registeredJobs.push({ name: config.name, delay: config.delay });
              return options?.queue === false
                ? null
                : { send: async (payload: unknown) => void sent.set("job", [payload]) };
            },
          },
        };
      },
    },
  } as unknown as WorkerEventingRuntime;

  return { runtime, sent, registeredJobs, definitions };
}

const definition = { name: "stub" } as never;

describe("worker feature installers", () => {
  describe("given a cross-feature command proxy that has not been installed yet", () => {
    it("refuses to dispatch rather than silently dropping the command", () => {
      const evaluation = EvaluationWorkerFeatureInstaller.create({
        installer: { buildProcessing: () => definition },
        eventing: eventingStub(["executeEvaluation", "reportEvaluation"]).runtime,
      });

      expect(() => evaluation.commands.executeEvaluation({})).toThrow(
        /evaluation.executeEvaluation/,
      );
    });
  });

  describe("when the feature installs", () => {
    it("binds Evaluation's two cross-pipeline senders to the registered pipeline", async () => {
      const eventing = eventingStub(["executeEvaluation", "reportEvaluation"]);
      const evaluation = EvaluationWorkerFeatureInstaller.create({
        installer: { buildProcessing: () => definition },
        eventing: eventing.runtime,
      });

      await evaluation.install();
      await evaluation.commands.executeEvaluation({ evaluationId: "eval-1" });

      expect(eventing.sent.get("executeEvaluation")).toEqual([{ evaluationId: "eval-1" }]);
    });

    it("binds Coding Agent's three contribution senders", async () => {
      const eventing = eventingStub([
        "contributeSpanFacts",
        "contributeMetricFacts",
        "contributeLogFacts",
      ]);
      const codingAgent = CodingAgentWorkerFeatureInstaller.create({
        installer: { buildProcessing: () => definition },
        eventing: eventing.runtime,
      });

      await codingAgent.install();
      await codingAgent.commands.contributeLogFacts({ sessionId: "s-1" });

      expect(eventing.sent.get("contributeLogFacts")).toEqual([{ sessionId: "s-1" }]);
    });

    it("binds Suite's two item senders and leaves startSuiteRun off the worker surface", async () => {
      const eventing = eventingStub([
        "startSuiteRun",
        "recordSuiteRunItemStarted",
        "completeSuiteRunItem",
      ]);
      const suite = SuiteWorkerFeatureInstaller.create({
        installer: { buildProcessing: () => definition },
        eventing: eventing.runtime,
      });

      await suite.install();

      expect(Object.keys(suite.commands)).toEqual([
        "recordSuiteRunItemStarted",
        "completeSuiteRunItem",
      ]);
    });

    it("registers Scenario's delayed metrics retry as a durable job and connects both dispatchers", async () => {
      const eventing = eventingStub(["computeRunMetrics"]);
      const connect = vi.fn();
      const scenario = ScenarioWorkerFeatureInstaller.create({
        installer: {
          buildProcessing: () => definition,
          deferredComputeRunMetricsJob: {
            name: "deferredComputeRunMetrics",
            delayMs: 30_000,
            makeJobId: () => "job-1",
            spanAttributes: () => ({}),
          },
          connect,
        },
        eventing: eventing.runtime,
      });

      await scenario.install();

      expect(eventing.registeredJobs).toEqual([
        { name: "deferredComputeRunMetrics", delay: 30_000 },
      ]);
      expect(connect).toHaveBeenCalledOnce();
      expect(Object.keys(connect.mock.calls[0]?.[0] ?? {})).toEqual([
        "computeRunMetrics",
        "scheduleComputeRunMetricsRetry",
      ]);
    });

    it("binds Experiment's metrics sender for the Trace-side subscriber", async () => {
      const eventing = eventingStub(["computeExperimentRunMetrics"]);
      const experiment = ExperimentWorkerFeatureInstaller.create({
        installer: { buildProcessing: () => definition },
        eventing: eventing.runtime,
      });

      await experiment.install();
      await experiment.commands.computeExperimentRunMetrics({ runId: "run-1" });

      expect(eventing.sent.get("computeExperimentRunMetrics")).toEqual([{ runId: "run-1" }]);
    });

    it("binds Governance's two signal senders for the Gateway debit adapter", async () => {
      const eventing = eventingStub(["recordVkLifecycle", "recordBudgetCrossing"]);
      const governance = GovernanceEventsWorkerFeatureInstaller.create({
        installer: { buildProcessing: () => definition },
        eventing: eventing.runtime,
      });

      await governance.install();
      await governance.commands.recordBudgetCrossing({ organizationId: "org-1" });

      expect(eventing.sent.get("recordBudgetCrossing")).toEqual([{ organizationId: "org-1" }]);
    });

    it("hands Gateway spend its own settleSpend sender for the settlement sweep", async () => {
      const eventing = eventingStub(["settleSpend"]);
      const connectSettlement = vi.fn();
      const gateway = GatewaySpendWorkerFeatureInstaller.create({
        installer: { buildProcessing: () => definition, connectSettlement },
        eventing: eventing.runtime,
      });

      await gateway.install();
      await connectSettlement.mock.calls[0]?.[0]({ requestId: "req-1" });

      expect(eventing.sent.get("settleSpend")).toEqual([{ requestId: "req-1" }]);
    });

    it("hands Billing reporting its own month sender for the self-dispatch walk", async () => {
      const eventing = eventingStub(["reportUsageForMonth"]);
      const connectSelfDispatch = vi.fn();
      const billing = BillingReportingWorkerFeatureInstaller.create({
        installer: { buildProcessing: () => definition, connectSelfDispatch },
        eventing: eventing.runtime,
      });

      await billing.install();
      await connectSelfDispatch.mock.calls[0]?.[0]({ month: "2026-08" });

      expect(eventing.sent.get("reportUsageForMonth")).toEqual([{ month: "2026-08" }]);
    });
  });

  describe("when the pipeline registers without a command the worker graph depends on", () => {
    it("fails at install rather than at first dispatch", async () => {
      const eventing = eventingStub(["executeEvaluation"]);
      const evaluation = EvaluationWorkerFeatureInstaller.create({
        installer: { buildProcessing: () => definition },
        eventing: eventing.runtime,
      });

      await expect(evaluation.install()).rejects.toThrow(/reportEvaluation/);
    });

    it("fails when Scenario's retry has no durable queue instead of degrading to a timer", async () => {
      const eventing = eventingStub(["computeRunMetrics"], { queue: false });
      const scenario = ScenarioWorkerFeatureInstaller.create({
        installer: {
          buildProcessing: () => definition,
          deferredComputeRunMetricsJob: {
            name: "deferredComputeRunMetrics",
            delayMs: 30_000,
            makeJobId: () => "job-1",
            spanAttributes: () => ({}),
          },
          connect: vi.fn(),
        },
        eventing: eventing.runtime,
      });

      await expect(scenario.install()).rejects.toThrow(/durable queue/);
    });
  });

  describe("when a feature is installed twice", () => {
    it("registers its definition once", async () => {
      const eventing = eventingStub(["executeEvaluation", "reportEvaluation"]);
      const evaluation = EvaluationWorkerFeatureInstaller.create({
        installer: { buildProcessing: () => definition },
        eventing: eventing.runtime,
      });

      await evaluation.install();
      await evaluation.install();

      expect(eventing.definitions).toHaveLength(1);
    });
  });

  describe("given Governance ingestion has not registered", () => {
    it("refuses to hand out an installation rather than reporting an empty one", async () => {
      const eventing = eventingStub([]);
      const register = vi.fn(() => ({
        ingestionPull: {},
        pulledUsage: {},
        lifecycle: {},
      }));
      const governance = GovernanceIngestionWorkerFeatureInstaller.create({
        installer: { register },
        eventing: eventing.runtime,
      });

      expect(() => governance.getInstallation()).toThrow(/have not been registered/);

      await governance.install();
      await governance.install();

      expect(register).toHaveBeenCalledOnce();
      expect(governance.getInstallation().lifecycle).toBeDefined();
    });
  });
});
