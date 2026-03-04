import { describe, it, expect } from "vitest";
import { PricingModel } from "@prisma/client";
import {
  resolveUsageMeter,
  normalizeUsageUnit,
} from "../usage-meter-policy";

describe("resolveUsageMeter", () => {
  describe("when no license override", () => {
    it("returns traces for TIERED pricing model", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        hasValidLicenseOverride: false,
        clickhouseAvailable: true,
      });

      expect(decision.usageUnit).toBe("traces");
      expect(decision.backend).toBe("clickhouse");
    });

    it("returns events for SEAT_EVENT pricing model", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.SEAT_EVENT,
        hasValidLicenseOverride: false,
        clickhouseAvailable: true,
      });

      expect(decision.usageUnit).toBe("events");
      expect(decision.backend).toBe("clickhouse");
    });

    it("defaults to traces when pricingModel is null", () => {
      const decision = resolveUsageMeter({
        pricingModel: null,
        hasValidLicenseOverride: false,
        clickhouseAvailable: true,
      });

      expect(decision.usageUnit).toBe("traces");
    });
  });

  describe("when license override is active", () => {
    it("uses license usageUnit over pricingModel", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        licenseUsageUnit: "events",
        hasValidLicenseOverride: true,
        clickhouseAvailable: true,
      });

      expect(decision.usageUnit).toBe("events");
    });

    it("normalizes license usageUnit", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        licenseUsageUnit: "EVENT",
        hasValidLicenseOverride: true,
        clickhouseAvailable: true,
      });

      expect(decision.usageUnit).toBe("events");
    });

    it("falls back to pricingModel when license has no usageUnit", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.SEAT_EVENT,
        licenseUsageUnit: undefined,
        hasValidLicenseOverride: true,
        clickhouseAvailable: true,
      });

      expect(decision.usageUnit).toBe("events");
    });
  });

  describe("backend selection", () => {
    it("prefers ClickHouse when available", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        hasValidLicenseOverride: false,
        clickhouseAvailable: true,
      });

      expect(decision.backend).toBe("clickhouse");
    });

    it("falls back to ElasticSearch when ClickHouse unavailable", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        hasValidLicenseOverride: false,
        clickhouseAvailable: false,
      });

      expect(decision.backend).toBe("elasticsearch");
    });
  });

  describe("reason traceability", () => {
    it("includes unit source and backend in reason", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        hasValidLicenseOverride: false,
        clickhouseAvailable: true,
      });

      expect(decision.reason).toContain("unit=traces");
      expect(decision.reason).toContain("pricingModel(TIERED)");
      expect(decision.reason).toContain("backend=clickhouse");
    });

    it("includes license source in reason when override active", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        licenseUsageUnit: "events",
        hasValidLicenseOverride: true,
        clickhouseAvailable: true,
      });

      expect(decision.reason).toContain("license(events)");
    });
  });
});

describe("normalizeUsageUnit", () => {
  it("normalizes 'events' to events", () => {
    expect(normalizeUsageUnit("events")).toBe("events");
  });

  it("normalizes 'event' to events", () => {
    expect(normalizeUsageUnit("event")).toBe("events");
  });

  it("normalizes 'EVENT' to events", () => {
    expect(normalizeUsageUnit("EVENT")).toBe("events");
  });

  it("normalizes 'traces' to traces", () => {
    expect(normalizeUsageUnit("traces")).toBe("traces");
  });

  it("defaults unknown values to traces", () => {
    expect(normalizeUsageUnit("unknown")).toBe("traces");
  });

  it("trims whitespace", () => {
    expect(normalizeUsageUnit("  events  ")).toBe("events");
  });
});
