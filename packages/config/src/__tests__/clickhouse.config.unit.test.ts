import { describe, expect, it } from "vitest";

import { mergeClickHousePrivateRoutes } from "../clickhouse.config.ts";

/**
 * Structural on purpose: this package takes a reporter rather than a logger,
 * so it needs no logging dependency and neither does its test.
 */
function recordingReport() {
  const lines: { attributes: Record<string, unknown>; message: string }[] = [];
  return {
    lines,
    report: {
      warn(attributes: Record<string, unknown>, message: string): void {
        lines.push({ attributes, message });
      },
    },
    find(messageIncludes: string) {
      return lines.find((line) => line.message.includes(messageIncludes))?.attributes;
    },
  };
}

const ACME = "http://acme:8123/langwatch";
const OTHER = "http://other:8123/langwatch";

describe("mergeClickHousePrivateRoutes", () => {
  describe("given routes declared under the one classified key", () => {
    /** @scenario "Routes declared under the one classified key are used" */
    it("routes each organization to the instance it names", () => {
      const recorded = recordingReport();

      const routes = mergeClickHousePrivateRoutes({
        declared: JSON.stringify([{ organizationId: "org123", url: ACME }]),
        perCustomer: [],
        report: recorded.report,
      });

      expect(routes).toEqual([{ organizationId: "org123", url: ACME }]);
      expect(recorded.lines).toHaveLength(0);
    });
  });

  describe("given an organization declared only in a per-customer variable", () => {
    /** @scenario "A per-customer variable still routes, and says it should move" */
    it("still routes it and asks for it to move to the one key", () => {
      const recorded = recordingReport();

      const routes = mergeClickHousePrivateRoutes({
        declared: undefined,
        perCustomer: [{ organizationId: "org123", url: ACME }],
        report: recorded.report,
      });

      expect(routes).toEqual([{ organizationId: "org123", url: ACME }]);
      expect(recorded.find("CLICKHOUSE_PRIVATE_ROUTES")).toMatchObject({
        organizationId: "org123",
        envVarPrefix: "CLICKHOUSE_URL__",
      });
    });
  });

  describe("given one organization declared in both, on different instances", () => {
    /** @scenario "One organization declared twice, differently, refuses the boot" */
    it("refuses rather than letting the merge order decide", () => {
      const recorded = recordingReport();

      expect(() =>
        mergeClickHousePrivateRoutes({
          declared: JSON.stringify([{ organizationId: "org123", url: ACME }]),
          perCustomer: [{ organizationId: "org123", url: OTHER }],
          report: recorded.report,
        }),
      ).toThrowError(/org123/);
    });
  });

  describe("given one organization declared in both, on the same instance", () => {
    it("keeps the single route it agrees on", () => {
      const recorded = recordingReport();

      expect(
        mergeClickHousePrivateRoutes({
          declared: JSON.stringify([{ organizationId: "org123", url: ACME }]),
          perCustomer: [{ organizationId: "org123", url: ACME }],
          report: recorded.report,
        }),
      ).toEqual([{ organizationId: "org123", url: ACME }]);
    });
  });

  describe("given an entry that is not an organization and a url", () => {
    /** @scenario "An entry that is not an organization and a url is skipped and reported" */
    it("routes nothing for it and names its position in the list", () => {
      const recorded = recordingReport();

      const routes = mergeClickHousePrivateRoutes({
        declared: JSON.stringify([
          { organizationId: "org123" },
          { organizationId: "ok", url: ACME },
        ]),
        perCustomer: [],
        report: recorded.report,
      });

      expect(routes).toEqual([{ organizationId: "ok", url: ACME }]);
      expect(recorded.find("not an organization id and a url")).toMatchObject({
        index: 0,
        reason: "invalid_shape",
      });
    });
  });
});
