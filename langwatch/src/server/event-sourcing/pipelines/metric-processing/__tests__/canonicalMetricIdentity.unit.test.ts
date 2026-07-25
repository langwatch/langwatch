import { describe, expect, it } from "vitest";
import { prepareMetricDataPoints } from "../canonicalMetric";
import { prepare, requestForMetric } from "./fixtures/canonical-metric.fixtures";

const a = { key: "a", value: { stringValue: "one" } };
const b = { key: "b", value: { intValue: "2" } };

function identityRequest({
  attributes,
  value,
  description,
  resourceValue = "service-a",
}: {
  attributes: unknown[];
  value: number;
  description: string;
  resourceValue?: string;
}) {
  return requestForMetric({
    metric: {
      name: "identity.metric",
      unit: "ms",
      description,
      gauge: {
        dataPoints: [
          { timeUnixNano: "1700000000000000000", asDouble: value, attributes },
        ],
      },
    },
    resourceAttributes: [
      { key: "service.name", value: { stringValue: resourceValue } },
    ],
  });
}

describe("canonical metric identity", () => {
  describe("when the same measurement arrives reordered or retried", () => {
    it("keeps SeriesId stable and excludes values and descriptions", async () => {
      const first = (
        await prepare({
          request: identityRequest({
            attributes: [a, b],
            value: 1,
            description: "first",
          }),
        })
      ).accepted[0]!.dataPoint;
      const reordered = (
        await prepare({
          request: identityRequest({
            attributes: [b, a],
            value: 1,
            description: "first",
          }),
        })
      ).accepted[0]!.dataPoint;
      const retried = (
        await prepare({
          request: identityRequest({
            attributes: [a, b],
            value: 1,
            description: "first",
          }),
          acceptedAt: 1_900_000_000_000,
        })
      ).accepted[0]!.dataPoint;
      const valueChanged = (
        await prepare({
          request: identityRequest({
            attributes: [a, b],
            value: 2,
            description: "first",
          }),
        })
      ).accepted[0]!.dataPoint;
      const descriptionChanged = (
        await prepare({
          request: identityRequest({
            attributes: [a, b],
            value: 1,
            description: "second",
          }),
        })
      ).accepted[0]!.dataPoint;
      const attributesChanged = (
        await prepare({
          request: identityRequest({
            attributes: [a, { ...b, value: { intValue: "3" } }],
            value: 1,
            description: "first",
          }),
        })
      ).accepted[0]!.dataPoint;
      const resourceChanged = (
        await prepare({
          request: identityRequest({
            attributes: [a, b],
            value: 1,
            description: "first",
            resourceValue: "service-b",
          }),
        })
      ).accepted[0]!.dataPoint;
      const tenantChanged = (
        await prepare({
          request: identityRequest({
            attributes: [a, b],
            value: 1,
            description: "first",
          }),
          tenantId: "project-2",
        })
      ).accepted[0]!.dataPoint;

      expect(reordered.seriesId).toBe(first.seriesId);
      expect(reordered.pointId).toBe(first.pointId);
      expect(retried.seriesId).toBe(first.seriesId);
      expect(retried.pointId).toBe(first.pointId);
      expect(retried.acceptedAt).not.toBe(first.acceptedAt);
      expect(valueChanged.seriesId).toBe(first.seriesId);
      expect(valueChanged.pointId).not.toBe(first.pointId);
      expect(descriptionChanged.seriesId).toBe(first.seriesId);
      expect(descriptionChanged.pointId).not.toBe(first.pointId);
      expect(attributesChanged.seriesId).not.toBe(first.seriesId);
      expect(resourceChanged.seriesId).not.toBe(first.seriesId);
      expect(tenantChanged.seriesId).not.toBe(first.seriesId);
    });
  });

  describe("when attribute keys collate differently by locale", () => {
    it("orders attributes by code unit so identity is host-independent", async () => {
      // In several ICU locales "ä" collates next to "a"; ordinal ordering puts
      // it after "z". Two workers must agree regardless of their ICU build.
      const attributes = [
        { key: "z", value: { stringValue: "1" } },
        { key: "ä", value: { stringValue: "2" } },
        { key: "a", value: { stringValue: "3" } },
      ];
      const point = (
        await prepare({
          request: requestForMetric({
            metric: {
              name: "collation.metric",
              gauge: {
                dataPoints: [
                  {
                    timeUnixNano: "1700000000000000000",
                    asDouble: 1,
                    attributes,
                  },
                ],
              },
            },
          }),
        })
      ).accepted[0]!.dataPoint;

      expect(point.pointAttributeKeys).toEqual(["a", "z", "ä"]);
    });
  });

  describe("when the redaction policy rewrites nested values", () => {
    it("redacts nested AnyValue strings without flattening their types", async () => {
      const redactionService = {
        redactMetricAttributes: async (metric: {
          attributes: Record<string, string>;
        }) => {
          for (const key of Object.keys(metric.attributes)) {
            if (metric.attributes[key] === "secret") {
              metric.attributes[key] = "[REDACTED]";
            }
          }
        },
      };
      const result = await prepareMetricDataPoints({
        tenantId: "project-1",
        organizationId: "organization-1",
        request: requestForMetric({
          metric: {
            name: "nested",
            gauge: {
              dataPoints: [
                {
                  timeUnixNano: "1700000000000000000",
                  asDouble: 1,
                  attributes: [
                    {
                      key: "nested",
                      value: {
                        kvlistValue: {
                          values: [
                            {
                              key: "array",
                              value: {
                                arrayValue: {
                                  values: [
                                    { stringValue: "secret" },
                                    { intValue: "7" },
                                  ],
                                },
                              },
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        }) as never,
        piiRedactionLevel: "STRICT",
        redactionService,
        acceptedAt: 1_800_000_000_000,
      });

      const point = result.accepted[0]!.dataPoint;
      expect(point.canonicalPayload).not.toContain("secret");
      expect(point.canonicalPayload).toContain("[REDACTED]");
      expect(point.pointAttributesJson).toContain('"type":"int","value":"7"');
    });
  });

  describe("when the redaction policy is not idempotent", () => {
    it("isolates resource redaction across sibling points", async () => {
      const redactionService = {
        redactMetricAttributes: async (metric: {
          attributes: Record<string, string>;
        }) => {
          for (const key of Object.keys(metric.attributes)) {
            metric.attributes[key] = `${metric.attributes[key]}-redacted`;
          }
        },
      };
      const result = await prepareMetricDataPoints({
        tenantId: "project-1",
        organizationId: "organization-1",
        request: requestForMetric({
          metric: {
            name: "siblings",
            gauge: {
              dataPoints: [
                { timeUnixNano: "1700000000000000000", asDouble: 1 },
                { timeUnixNano: "1700000001000000000", asDouble: 2 },
              ],
            },
          },
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
      expect(
        result.accepted[1]!.dataPoint.resourceAttributesJson,
      ).not.toContain("api-redacted-redacted");
    });
  });
});
