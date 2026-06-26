import { PricingModel } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { normalizeUsageUnit, resolveUsageMeter } from "../usage-meter-policy";

describe("resolveUsageMeter", () => {
  describe("when paid organization (isFree=false)", () => {
    describe("when no license override", () => {
      /** @scenario "Paid TIERED organization counts each trace as one unit" */
      it("returns traces for TIERED pricing model", () => {
        const decision = resolveUsageMeter({
          pricingModel: PricingModel.TIERED,
          isFree: false,
          hasValidLicenseOverride: false,
          clickhouseAvailable: true,
        });

        expect(decision.usageUnit).toBe("traces");
        expect(decision.backend).toBe("clickhouse");
      });

      /** @scenario "Paid SEAT_EVENT organization counts each span toward the limit" */
      it("returns events for SEAT_EVENT pricing model", () => {
        const decision = resolveUsageMeter({
          pricingModel: PricingModel.SEAT_EVENT,
          isFree: false,
          hasValidLicenseOverride: false,
          clickhouseAvailable: true,
        });

        expect(decision.usageUnit).toBe("events");
        expect(decision.backend).toBe("clickhouse");
      });

      it("defaults to traces when pricingModel is null", () => {
        const decision = resolveUsageMeter({
          pricingModel: null,
          isFree: false,
          hasValidLicenseOverride: false,
          clickhouseAvailable: true,
        });

        expect(decision.usageUnit).toBe("traces");
      });
    });

    describe("when license override is active", () => {
      /** @scenario "Licensed organization respects its own counting rule" */
      it("uses license usageUnit over pricingModel", () => {
        const decision = resolveUsageMeter({
          pricingModel: PricingModel.TIERED,
          licenseUsageUnit: "events",
          isFree: false,
          hasValidLicenseOverride: true,
          clickhouseAvailable: true,
        });

        expect(decision.usageUnit).toBe("events");
      });

      it("normalizes license usageUnit", () => {
        const decision = resolveUsageMeter({
          pricingModel: PricingModel.TIERED,
          licenseUsageUnit: "EVENT",
          isFree: false,
          hasValidLicenseOverride: true,
          clickhouseAvailable: true,
        });

        expect(decision.usageUnit).toBe("events");
      });

      it("falls back to pricingModel when license has no usageUnit", () => {
        const decision = resolveUsageMeter({
          pricingModel: PricingModel.SEAT_EVENT,
          licenseUsageUnit: undefined,
          isFree: false,
          hasValidLicenseOverride: true,
          clickhouseAvailable: true,
        });

        expect(decision.usageUnit).toBe("events");
      });
    });
  });

  describe("when free organization (isFree=true)", () => {
    /** @scenario "Free TIERED organization counts each span toward the limit" */
    it("returns events for TIERED pricing model", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        isFree: true,
        hasValidLicenseOverride: false,
        clickhouseAvailable: true,
      });

      expect(decision.usageUnit).toBe("events");
    });

    /** @scenario "Free SEAT_EVENT organization counts each span toward the limit" */
    it("returns events for SEAT_EVENT pricing model", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.SEAT_EVENT,
        isFree: true,
        hasValidLicenseOverride: false,
        clickhouseAvailable: true,
      });

      expect(decision.usageUnit).toBe("events");
    });

    it("returns events when pricingModel is null", () => {
      const decision = resolveUsageMeter({
        pricingModel: null,
        isFree: true,
        hasValidLicenseOverride: false,
        clickhouseAvailable: true,
      });

      expect(decision.usageUnit).toBe("events");
    });

    it("respects license override even when free", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        licenseUsageUnit: "traces",
        isFree: true,
        hasValidLicenseOverride: true,
        clickhouseAvailable: true,
      });

      expect(decision.usageUnit).toBe("traces");
    });
  });

  describe("backend selection", () => {
    it("prefers ClickHouse when available", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        isFree: false,
        hasValidLicenseOverride: false,
        clickhouseAvailable: true,
      });

      expect(decision.backend).toBe("clickhouse");
    });

    it("falls back to ElasticSearch when ClickHouse unavailable", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        isFree: false,
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
        isFree: false,
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
        isFree: false,
        hasValidLicenseOverride: true,
        clickhouseAvailable: true,
      });

      expect(decision.reason).toContain("license(events)");
    });

    it("reports freeTier as source when free TIERED", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        isFree: true,
        hasValidLicenseOverride: false,
        clickhouseAvailable: true,
      });

      expect(decision.reason).toContain("from freeTier");
      expect(decision.reason).toContain("isFree=true");
    });

    it("includes isFree in reason when paid", () => {
      const decision = resolveUsageMeter({
        pricingModel: PricingModel.TIERED,
        isFree: false,
        hasValidLicenseOverride: false,
        clickhouseAvailable: true,
      });

      expect(decision.reason).toContain("isFree=false");
    });
  });
});

describe("counting unit by organization profile", () => {
  /** @scenario Free TIERED organization counts each span toward the limit */
  it("counts each span (events unit) for a free TIERED organization", () => {
    const decision = resolveUsageMeter({
      pricingModel: PricingModel.TIERED,
      isFree: true,
      hasValidLicenseOverride: false,
      clickhouseAvailable: true,
    });

    expect(decision.usageUnit).toBe("events");
  });

  /** @scenario Free SEAT_EVENT organization counts each span toward the limit */
  it("counts each span (events unit) for a free SEAT_EVENT organization", () => {
    const decision = resolveUsageMeter({
      pricingModel: PricingModel.SEAT_EVENT,
      isFree: true,
      hasValidLicenseOverride: false,
      clickhouseAvailable: true,
    });

    expect(decision.usageUnit).toBe("events");
  });

  /** @scenario Paid TIERED organization counts each trace as one unit */
  it("counts each trace (traces unit) for a paid TIERED organization", () => {
    const decision = resolveUsageMeter({
      pricingModel: PricingModel.TIERED,
      isFree: false,
      hasValidLicenseOverride: false,
      clickhouseAvailable: true,
    });

    expect(decision.usageUnit).toBe("traces");
  });

  /** @scenario Paid SEAT_EVENT organization counts each span toward the limit */
  it("counts each span (events unit) for a paid SEAT_EVENT organization", () => {
    const decision = resolveUsageMeter({
      pricingModel: PricingModel.SEAT_EVENT,
      isFree: false,
      hasValidLicenseOverride: false,
      clickhouseAvailable: true,
    });

    expect(decision.usageUnit).toBe("events");
  });

  /** @scenario Licensed organization respects its own counting rule */
  it("uses the license-specified counting unit for a licensed organization", () => {
    const decision = resolveUsageMeter({
      pricingModel: PricingModel.SEAT_EVENT,
      licenseUsageUnit: "traces",
      isFree: true,
      hasValidLicenseOverride: true,
      clickhouseAvailable: true,
    });

    expect(decision.usageUnit).toBe("traces");
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
