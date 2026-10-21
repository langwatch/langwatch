import { afterAll, describe, expect, it } from "vitest";

import { metricInstrumentInAServiceRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent-metrics.service.ts";
const TEST = "modules/agent/process/src/services/__tests__/agent-metrics.service.unit.test.ts";
const IMPORT = 'import { counter, histogram } from "@langwatch/observability/metrics";';

function report(code, filename = SERVICE) {
  return runRule(metricInstrumentInAServiceRule, { code, cwd: workspace.cwd, filename }).map(
    ({ data, line, messageId }) => ({ data, line, messageId }),
  );
}

describe("given a module's production code", () => {
  describe("when an instrument is created at module scope", () => {
    /** @scenario "An instrument created at module scope is reported" */
    it("reports instrumentAtModuleScope on the call", () => {
      const code = [
        IMPORT,
        'const failures = counter({ name: "langwatch_agent_failures_total", description: "x" });',
        "export const latency = histogram({",
        '  name: "langwatch_agent_latency_seconds",',
        '  description: "x",',
        "});",
      ].join("\n");

      expect(report(code)).toEqual([
        { data: { factory: "counter" }, line: 2, messageId: "instrumentAtModuleScope" },
        { data: { factory: "histogram" }, line: 3, messageId: "instrumentAtModuleScope" },
      ]);
    });

    /** @scenario "The report tells the author where the instrument belongs" */
    it("names the metrics service in the fix", () => {
      const [finding] = runRule(metricInstrumentInAServiceRule, {
        code: `${IMPORT}\nconst a = counter({ name: "langwatch_a_total", description: "x" });`,
        cwd: workspace.cwd,
        filename: SERVICE,
      });

      expect(finding.message).toContain("<subject>-metrics.service.ts");
    });
  });

  describe("when an instrument is reached through a namespace or a meter", () => {
    /** @scenario "An instrument reached through a namespace or a meter is reported" */
    it("reports instrumentAtModuleScope on each call", () => {
      const code = [
        'import * as metrics from "@langwatch/observability/metrics";',
        'import { metrics as otel } from "@opentelemetry/api";',
        'const failures = metrics.counter({ name: "langwatch_agent_failures_total" });',
        'const latency = otel.getMeter("agent").createHistogram("langwatch_agent_latency_seconds");',
        'class AgentMetricsService { readonly sent = metrics.counter({ name: "langwatch_agent_sent_total" }); }',
      ].join("\n");

      expect(report(code)).toEqual([
        { data: { factory: "counter" }, line: 3, messageId: "instrumentAtModuleScope" },
        { data: { factory: "createHistogram" }, line: 4, messageId: "instrumentAtModuleScope" },
      ]);
    });
  });

  describe("when an instrument is created inside a class or a function", () => {
    /** @scenario "An instrument inside a service class is accepted" */
    it("reports nothing", () => {
      const code = [
        IMPORT,
        "export class AgentMetricsService {",
        '  private readonly failures = counter({ name: "langwatch_agent_failures_total", description: "x" });',
        "  constructor() {",
        '    this.latency = histogram({ name: "langwatch_agent_latency_seconds", description: "x" });',
        "  }",
        "}",
        'export const build = () => counter({ name: "langwatch_agent_built_total", description: "x" });',
      ].join("\n");

      expect(report(code)).toEqual([]);
    });
  });

  describe("when a series name lacks the langwatch_ prefix", () => {
    /** @scenario "A series name without the langwatch_ prefix is reported" */
    it("reports seriesNeedsPrefix, including a name held in a module constant", () => {
      const code = [
        IMPORT,
        'const NAME = "agent_blocks_total";',
        "export class A {",
        '  a = counter({ name: "agent_failures_total", description: "x" });',
        '  b = counter({ name: NAME, description: "x" });',
        "}",
      ].join("\n");

      expect(report(code)).toEqual([
        { data: { name: "agent_failures_total" }, line: 4, messageId: "seriesNeedsPrefix" },
        { data: { name: "agent_blocks_total" }, line: 5, messageId: "seriesNeedsPrefix" },
      ]);
    });

    /** @scenario "A series dashboards already read keeps its name" */
    it("accepts a name in the legacy set", () => {
      const code = [
        IMPORT,
        "export class A {",
        '  a = counter({ name: "pii_checks", description: "x" });',
        "}",
      ].join("\n");

      expect(report(code)).toEqual([]);
    });
  });

  describe("when the call is not the observability factory", () => {
    /** @scenario "A call that is not the metrics factory is left alone" */
    it("reports nothing for a local counter, a test file or a non-module file", () => {
      const local = 'function counter(x) { return x; }\nconst a = counter({ name: "nope" });';

      expect(report(local)).toEqual([]);
      expect(report(`${IMPORT}\nconst a = counter({ name: "nope" });`, TEST)).toEqual([]);
      expect(
        report(`${IMPORT}\nconst a = counter({ name: "nope" });`, "packages/x/src/a.ts"),
      ).toEqual([]);
    });
  });
});
