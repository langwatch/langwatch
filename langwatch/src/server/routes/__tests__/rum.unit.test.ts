/**
 * @vitest-environment node
 *
 * Binds the scenarios `Telemetry claiming to be another service is refused` and
 * `Browser telemetry is identifiable as internal` in
 * specs/observability/browser-rum-trace-correlation.feature. See ADR-058.
 */
import { RUM_SERVICE_NAME } from "@langwatch/react-rum";
import { describe, expect, it } from "vitest";

import {
  claimsAnotherService,
  type OtlpResourceSpans,
  stampPlatformOrigin,
} from "../rum";

const resourceSpansFor = (
  attributes: Array<{ key: string; value: { stringValue: string } }>,
): OtlpResourceSpans[] => [{ resource: { attributes } }];

const serviceName = (value: string) => ({
  key: "service.name",
  value: { stringValue: value },
});

const originOf = (resourceSpans: OtlpResourceSpans[]) =>
  resourceSpans[0]?.resource?.attributes?.filter(
    (attribute) => attribute.key === "langwatch.origin",
  );

describe("claimsAnotherService", () => {
  describe("given telemetry from the browser app", () => {
    it("accepts it", () => {
      expect(
        claimsAnotherService(resourceSpansFor([serviceName(RUM_SERVICE_NAME)])),
      ).toBe(false);
    });
  });

  describe("given telemetry claiming to be something else", () => {
    it("refuses a different service", () => {
      expect(
        claimsAnotherService(resourceSpansFor([serviceName("langwatch-app")])),
      ).toBe(true);
    });

    it("refuses telemetry that names no service at all", () => {
      expect(claimsAnotherService(resourceSpansFor([]))).toBe(true);
    });

    /** One honest batch must not launder a dishonest one alongside it. */
    it("refuses a mixed batch even when part of it is legitimate", () => {
      expect(
        claimsAnotherService([
          ...resourceSpansFor([serviceName(RUM_SERVICE_NAME)]),
          ...resourceSpansFor([serviceName("something-else")]),
        ]),
      ).toBe(true);
    });
  });
});

describe("stampPlatformOrigin", () => {
  describe("given telemetry with no origin marker", () => {
    it("marks it as the platform describing itself", () => {
      const resourceSpans = resourceSpansFor([
        serviceName(RUM_SERVICE_NAME),
      ]);

      stampPlatformOrigin(resourceSpans);

      expect(originOf(resourceSpans)).toEqual([
        { key: "langwatch.origin", value: { stringValue: "platform_internal" } },
      ]);
    });

    it("leaves the other attributes alone", () => {
      const resourceSpans = resourceSpansFor([serviceName(RUM_SERVICE_NAME)]);

      stampPlatformOrigin(resourceSpans);

      expect(resourceSpans[0]?.resource?.attributes).toContainEqual(
        serviceName(RUM_SERVICE_NAME),
      );
    });
  });

  describe("given a client that supplied its own origin marker", () => {
    /**
     * The marker's whole value is that it cannot be omitted or chosen, so a
     * client-supplied one is replaced rather than trusted or appended.
     */
    it("overwrites it rather than trusting it", () => {
      const resourceSpans = resourceSpansFor([
        serviceName(RUM_SERVICE_NAME),
        { key: "langwatch.origin", value: { stringValue: "customer" } },
      ]);

      stampPlatformOrigin(resourceSpans);

      expect(originOf(resourceSpans)).toEqual([
        { key: "langwatch.origin", value: { stringValue: "platform_internal" } },
      ]);
    });
  });

  describe("given telemetry carrying no resource", () => {
    it("still marks it, rather than throwing", () => {
      const resourceSpans: OtlpResourceSpans[] = [{}];

      expect(() => stampPlatformOrigin(resourceSpans)).not.toThrow();
      expect(originOf(resourceSpans)).toEqual([
        { key: "langwatch.origin", value: { stringValue: "platform_internal" } },
      ]);
    });
  });
});
