import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { platformUrl } from "../platform-url";

describe("platformUrl", () => {
  const originalEnv = process.env.BASE_HOST;

  afterEach(() => {
    process.env.BASE_HOST = originalEnv;
  });

  describe("when BASE_HOST is set", () => {
    beforeEach(() => {
      process.env.BASE_HOST = "https://app.langwatch.ai";
    });

    it("builds a direct page URL", () => {
      expect(
        platformUrl({ projectSlug: "my-project", path: "/datasets/ds_123" })
      ).toBe("https://app.langwatch.ai/my-project/datasets/ds_123");
    });

    it("builds a drawer URL with query params", () => {
      expect(
        platformUrl({
          projectSlug: "my-project",
          path: "/evaluations?drawer.open=onlineEvaluation&drawer.monitorId=mon_123",
        })
      ).toBe(
        "https://app.langwatch.ai/my-project/evaluations?drawer.open=onlineEvaluation&drawer.monitorId=mon_123"
      );
    });

    it("strips trailing slash from BASE_HOST", () => {
      process.env.BASE_HOST = "https://app.langwatch.ai/";
      expect(
        platformUrl({ projectSlug: "test", path: "/datasets/ds_1" })
      ).toBe("https://app.langwatch.ai/test/datasets/ds_1");
    });
  });

  describe("when BASE_HOST is not set", () => {
    beforeEach(() => {
      delete process.env.BASE_HOST;
    });

    it("falls back to localhost:5560", () => {
      expect(
        platformUrl({ projectSlug: "demo", path: "/agents" })
      ).toBe("http://localhost:5560/demo/agents");
    });
  });

  describe("resource URL patterns", () => {
    beforeEach(() => {
      process.env.BASE_HOST = "https://app.langwatch.ai";
    });

    it("generates correct dataset page URL", () => {
      const url = platformUrl({ projectSlug: "p", path: "/datasets/ds_abc" });
      expect(url).toContain("/p/datasets/ds_abc");
    });

    it("generates correct trace page URL", () => {
      const url = platformUrl({ projectSlug: "p", path: "/messages/trace_abc" });
      expect(url).toContain("/p/messages/trace_abc");
    });

    it("generates correct monitor drawer URL", () => {
      const url = platformUrl({
        projectSlug: "p",
        path: "/evaluations?drawer.open=onlineEvaluation&drawer.monitorId=mon_1",
      });
      expect(url).toContain("drawer.open=onlineEvaluation");
      expect(url).toContain("drawer.monitorId=mon_1");
    });

    it("generates correct evaluator drawer URL", () => {
      const url = platformUrl({
        projectSlug: "p",
        path: "/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=ev_1",
      });
      expect(url).toContain("drawer.open=evaluatorEditor");
      expect(url).toContain("drawer.evaluatorId=ev_1");
    });

    it("generates correct agent drawer URL for code type", () => {
      const url = platformUrl({
        projectSlug: "p",
        path: "/agents?drawer.open=agentCodeEditor&drawer.agentId=ag_1",
      });
      expect(url).toContain("drawer.open=agentCodeEditor");
      expect(url).toContain("drawer.agentId=ag_1");
    });

    it("generates correct agent drawer URL for http type", () => {
      const url = platformUrl({
        projectSlug: "p",
        path: "/agents?drawer.open=agentHttpEditor&drawer.agentId=ag_2",
      });
      expect(url).toContain("drawer.open=agentHttpEditor");
    });

    it("generates correct scenario drawer URL", () => {
      const url = platformUrl({
        projectSlug: "p",
        path: "/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=sc_1",
      });
      expect(url).toContain("drawer.open=scenarioEditor");
      expect(url).toContain("drawer.scenarioId=sc_1");
    });

    it("generates correct trigger drawer URL", () => {
      const url = platformUrl({
        projectSlug: "p",
        path: "/automations?drawer.open=editAutomationFilter&drawer.automationId=tr_1",
      });
      expect(url).toContain("drawer.open=editAutomationFilter");
      expect(url).toContain("drawer.automationId=tr_1");
    });

    it("generates correct dashboard page URL", () => {
      const url = platformUrl({ projectSlug: "p", path: "/analytics/custom/dash_1" });
      expect(url).toContain("/p/analytics/custom/dash_1");
    });

    it("generates correct suite detail URL", () => {
      const url = platformUrl({
        projectSlug: "p",
        path: "/simulations/run-plans/my-suite-slug",
      });
      expect(url).toContain("/p/simulations/run-plans/my-suite-slug");
    });
  });
});
