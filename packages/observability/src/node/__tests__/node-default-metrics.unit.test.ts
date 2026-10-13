// @vitest-environment node
import { Counter, register } from "prom-client";
import { afterEach, describe, expect, it } from "vitest";

import { installNodeDefaultMetrics, withRegistryFamilies } from "../node-default-metrics.ts";
import { PROMETHEUS_CONTENT_TYPE } from "../prometheus-metrics-door.ts";

/** Spec: specs/server/api-process-metrics.feature */
const CLASH = "node_default_metrics_clash_total";

afterEach(() => {
  register.removeSingleMetric(CLASH);
});

describe("Node's default collectors on the scrape", () => {
  describe("when installed twice in one process", () => {
    /** @scenario "The scrape carries Node's default collectors" */
    it("registers each collector once and renders it beside the OTel exposition", async () => {
      installNodeDefaultMetrics();
      const collectors = register.getMetricsAsArray().length;
      installNodeDefaultMetrics();

      const { body } = await withRegistryFamilies({
        body: "# HELP otel_probe x\n# TYPE otel_probe gauge\notel_probe 1\n",
        contentType: PROMETHEUS_CONTENT_TYPE,
      });

      expect(register.getMetricsAsArray()).toHaveLength(collectors);
      expect(body.startsWith("# HELP otel_probe x\n")).toBe(true);
      expect(body).toContain("# TYPE process_cpu_user_seconds_total counter");
      expect(body).toContain("# TYPE nodejs_heap_size_total_bytes gauge");
    });
  });

  describe("when the registry holds a family the OTel exposition already names", () => {
    it("keeps the OTel family and drops the registry's, so each name has one TYPE", async () => {
      new Counter({ name: CLASH, help: "registry side" }).inc();

      const { body } = await withRegistryFamilies({
        body: `# HELP ${CLASH} otel side\n# TYPE ${CLASH} counter\n${CLASH} 3\n`,
        contentType: PROMETHEUS_CONTENT_TYPE,
      });

      expect(body.split(`# TYPE ${CLASH} `)).toHaveLength(2);
      expect(body).not.toContain("registry side");
    });
  });
});
