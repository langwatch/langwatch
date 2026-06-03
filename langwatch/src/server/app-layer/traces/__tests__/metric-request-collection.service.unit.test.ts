import { describe, expect, it, vi } from "vitest";

import type { RecordMetricCommandData } from "../../../event-sourcing/pipelines/trace-processing/schemas/commands";
import { MetricRequestCollectionService } from "../metric-request-collection.service";

function makeService() {
  const recordMetric = vi.fn<
    (data: RecordMetricCommandData) => Promise<void>
  >(() => Promise.resolve());
  const service = new MetricRequestCollectionService({ recordMetric });
  return { service, recordMetric };
}

describe("MetricRequestCollectionService", () => {
  describe("when a gauge data point has no exemplar (no trace context)", () => {
    /**
     * OTLP exporters that emit standalone gauges (Claude Code's
     * OTEL_METRICS_EXPORTER without a traces exporter is the canonical
     * caller) never attach exemplars with trace_id/span_id. The handler
     * previously dropped these silently because extractSimpleDataPoint
     * returned null without exemplars and the outer loop required
     * traceId+spanId. Standalone metrics are now stored with empty
     * TraceId/SpanId — the value, timestamp and attributes are the
     * meaningful payload.
     */
    it("records the metric with empty trace and span ids", async () => {
      const { service, recordMetric } = makeService();

      await service.handleOtlpMetricRequest({
        tenantId: "project_test_tenant",
        metricRequest: {
          resourceMetrics: [
            {
              resource: {
                attributes: [
                  {
                    key: "service.name",
                    value: { stringValue: "standalone-metrics-emitter" },
                  },
                ],
              },
              scopeMetrics: [
                {
                  scope: { name: "test", version: "1.0.0" },
                  metrics: [
                    {
                      name: "claude_code.session.count",
                      unit: "{session}",
                      gauge: {
                        dataPoints: [
                          {
                            timeUnixNano: "1700000000000000000",
                            asInt: 1,
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        piiRedactionLevel: "ESSENTIAL",
      });

      expect(recordMetric).toHaveBeenCalledTimes(1);
      const [call] = recordMetric.mock.calls;
      expect(call?.[0]).toMatchObject({
        tenantId: "project_test_tenant",
        traceId: "",
        spanId: "",
        metricName: "claude_code.session.count",
        metricType: "gauge",
        value: 1,
      });
    });
  });

  describe("when a sum data point has no exemplar", () => {
    it("records the metric with empty ids", async () => {
      const { service, recordMetric } = makeService();

      await service.handleOtlpMetricRequest({
        tenantId: "project_test_tenant",
        metricRequest: {
          resourceMetrics: [
            {
              resource: { attributes: [] },
              scopeMetrics: [
                {
                  scope: { name: "test", version: undefined },
                  metrics: [
                    {
                      name: "claude_code.messages.total",
                      unit: "{message}",
                      sum: {
                        dataPoints: [
                          {
                            timeUnixNano: "1700000000000000000",
                            asInt: 42,
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        piiRedactionLevel: "ESSENTIAL",
      });

      expect(recordMetric).toHaveBeenCalledTimes(1);
      const [call] = recordMetric.mock.calls;
      expect(call?.[0]).toMatchObject({
        traceId: "",
        spanId: "",
        metricName: "claude_code.messages.total",
        metricType: "sum",
        value: 42,
      });
    });
  });
});
