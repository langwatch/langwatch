import { describe, expect, it } from "vitest";
import { prepareMetricDataPoints } from "../prepareMetricDataPoints";
import { gaugeMetric, prepare, requestForMetric } from "./fixtures";

describe("prepareMetricDataPoints", () => {
  describe("when the redaction policy is not idempotent", () => {
    it("isolates resource redaction across sibling points in one request", async () => {
      const redactionService = {
        redactMetricAttributes: async (metricAttrs: {
          attributes: Record<string, string>;
        }) => {
          for (const key of Object.keys(metricAttrs.attributes)) {
            metricAttrs.attributes[key] =
              `${metricAttrs.attributes[key]}-redacted`;
          }
        },
      };
      const result = await prepareMetricDataPoints({
        tenantId: "project-1",
        organizationId: "organization-1",
        request: requestForMetric({
          metric: gaugeMetric({
            dataPoints: [
              { timeUnixNano: "1700000000000000000", asDouble: 1 },
              { timeUnixNano: "1700000001000000000", asDouble: 2 },
            ],
          }),
          resourceAttributes: [
            { key: "service.name", value: { stringValue: "api" } },
          ],
        }) as never,
        piiRedactionLevel: "STRICT",
        redactionService,
        acceptedAt: 1_800_000_000_000,
      });

      expect(result.accepted).toHaveLength(2);
      expect(result.accepted[0]!.dataPoint.seriesId).toBe(
        result.accepted[1]!.dataPoint.seriesId,
      );
      expect(result.accepted[0]!.dataPoint.resourceAttributesJson).toContain(
        "api-redacted",
      );
      // A non-idempotent redactor must not compound across siblings — each
      // point gets a fresh clone of the resource template, so the second
      // point never sees the first point's already-redacted value.
      expect(
        result.accepted[1]!.dataPoint.resourceAttributesJson,
      ).not.toContain("api-redacted-redacted");
    });
  });
  describe("when the project sends a data point whose value is not a finite number", () => {
    /** @scenario "A non-finite value is refused rather than stored as nothing" */
    it("reports that point as rejected, and stores no point for it", async () => {
      const result = await prepare({
        request: requestForMetric({
          metric: gaugeMetric({
            dataPoints: [
              { timeUnixNano: "1700000000000000000", asDouble: Number.NaN },
            ],
          }),
        }),
      });

      expect(result.accepted).toHaveLength(0);
      expect(result.rejectedDataPoints).toBeGreaterThan(0);
      expect(
        result.errors.some((message) => message.includes("asDouble")),
      ).toBe(true);
    });
  });

  describe("when the project sends a request whose metric container is malformed", () => {
    /** @scenario "A malformed batch is counted, not crashed on" */
    it("reports the affected points as rejected, and still accepts the well-formed points", async () => {
      const wellFormed = gaugeMetric({
        dataPoints: [{ timeUnixNano: "1700000000000000000", asDouble: 4 }],
      });
      const malformed = {
        name: "broken.metric",
        gauge: { dataPoints: "not-an-array" },
      };

      const result = await prepare({
        request: {
          resourceMetrics: [
            {
              resource: { attributes: [] },
              scopeMetrics: [
                { scope: { name: "s" }, metrics: [wellFormed, malformed] },
              ],
            },
          ],
        },
      });

      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0]!.dataPoint.valueDouble).toBe(4);
      expect(result.rejectedDataPoints).toBeGreaterThan(0);
      expect(
        result.errors.some((message) => message.includes("broken.metric")),
      ).toBe(true);
    });
  });

  describe("given a data point carries an exemplar that cannot be correlated to a span", () => {
    /** @scenario "An exemplar that cannot be correlated does not block acceptance" */
    it("the point is accepted and carries no correlation record for that exemplar", async () => {
      const result = await prepare({
        request: requestForMetric({
          metric: gaugeMetric({
            dataPoints: [
              {
                timeUnixNano: "1700000000000000000",
                asDouble: 1,
                exemplars: [
                  {
                    timeUnixNano: "1700000000000000000",
                    asDouble: 1,
                    // Neither traceId nor spanId is a valid OTel id, so this
                    // exemplar cannot be tied to a span.
                    traceId: "",
                    spanId: "",
                  },
                ],
              },
            ],
          }),
        }),
      });

      expect(result.rejectedDataPoints).toBe(0);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0]!.correlations).toHaveLength(0);
    });
  });
});
