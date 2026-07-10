import { describe, expect, it } from "vitest";
import { normalizeUsageUnit, resolveUsageMeter } from "../usage-meter-policy";

describe("resolveUsageMeter", () => {
  describe("when paid organization (isFree=false)", () => {
    describe("when no license override", () => {
      /** @scenario "Paid TIERED organization counts each trace as one unit" */
      it("returns traces for a paid org without seat-event billing", () => {
        const decision = resolveUsageMeter({
          isSeatEvent: false,
          isFree: false,
          hasValidLicenseOverride: false,
        });

        expect(decision.usageUnit).toBe("traces");
      });

      /** @scenario "Paid SEAT_EVENT organization counts each span toward the limit" */
      it("returns events for seat-event billing", () => {
        const decision = resolveUsageMeter({
          isSeatEvent: true,
          isFree: false,
          hasValidLicenseOverride: false,
        });

        expect(decision.usageUnit).toBe("events");
      });

      it("defaults to traces when not seat-event billed", () => {
        const decision = resolveUsageMeter({
          isSeatEvent: false,
          isFree: false,
          hasValidLicenseOverride: false,
        });

        expect(decision.usageUnit).toBe("traces");
      });
    });

    describe("when license override is active", () => {
      /** @scenario "Licensed organization respects its own counting rule" */
      it("uses license usageUnit over subscription billing", () => {
        const decision = resolveUsageMeter({
          isSeatEvent: false,
          licenseUsageUnit: "events",
          isFree: false,
          hasValidLicenseOverride: true,
        });

        expect(decision.usageUnit).toBe("events");
      });

      it("normalizes license usageUnit", () => {
        const decision = resolveUsageMeter({
          isSeatEvent: false,
          licenseUsageUnit: "EVENT",
          isFree: false,
          hasValidLicenseOverride: true,
        });

        expect(decision.usageUnit).toBe("events");
      });

      it("falls back to subscription billing when license has no usageUnit", () => {
        const decision = resolveUsageMeter({
          isSeatEvent: true,
          licenseUsageUnit: undefined,
          isFree: false,
          hasValidLicenseOverride: true,
        });

        expect(decision.usageUnit).toBe("events");
      });
    });
  });

  describe("when free organization (isFree=true)", () => {
    /** @scenario "Free TIERED organization counts each span toward the limit" */
    it("returns events for a free org without seat-event billing", () => {
      const decision = resolveUsageMeter({
        isSeatEvent: false,
        isFree: true,
        hasValidLicenseOverride: false,
      });

      expect(decision.usageUnit).toBe("events");
    });

    /** @scenario "Free SEAT_EVENT organization counts each span toward the limit" */
    it("returns events for seat-event billing", () => {
      const decision = resolveUsageMeter({
        isSeatEvent: true,
        isFree: true,
        hasValidLicenseOverride: false,
      });

      expect(decision.usageUnit).toBe("events");
    });

    it("returns events when not seat-event billed", () => {
      const decision = resolveUsageMeter({
        isSeatEvent: false,
        isFree: true,
        hasValidLicenseOverride: false,
      });

      expect(decision.usageUnit).toBe("events");
    });

    it("respects license override even when free", () => {
      const decision = resolveUsageMeter({
        isSeatEvent: false,
        licenseUsageUnit: "traces",
        isFree: true,
        hasValidLicenseOverride: true,
      });

      expect(decision.usageUnit).toBe("traces");
    });
  });

  describe("reason traceability", () => {
    it("includes unit source in reason", () => {
      const decision = resolveUsageMeter({
        isSeatEvent: false,
        isFree: false,
        hasValidLicenseOverride: false,
      });

      expect(decision.reason).toContain("unit=traces");
      expect(decision.reason).toContain("subscription(seatEvent=false)");
    });

    it("includes license source in reason when override active", () => {
      const decision = resolveUsageMeter({
        isSeatEvent: false,
        licenseUsageUnit: "events",
        isFree: false,
        hasValidLicenseOverride: true,
      });

      expect(decision.reason).toContain("license(events)");
    });

    it("reports freeTier as source when free TIERED", () => {
      const decision = resolveUsageMeter({
        isSeatEvent: false,
        isFree: true,
        hasValidLicenseOverride: false,
      });

      expect(decision.reason).toContain("from freeTier");
      expect(decision.reason).toContain("isFree=true");
    });

    it("includes isFree in reason when paid", () => {
      const decision = resolveUsageMeter({
        isSeatEvent: false,
        isFree: false,
        hasValidLicenseOverride: false,
      });

      expect(decision.reason).toContain("isFree=false");
    });
  });
});

describe("counting unit by organization profile", () => {
  /** @scenario Free TIERED organization counts each span toward the limit */
  it("counts each span (events unit) for a free TIERED organization", () => {
    const decision = resolveUsageMeter({
      isSeatEvent: false,
      isFree: true,
      hasValidLicenseOverride: false,
    });

    expect(decision.usageUnit).toBe("events");
  });

  /** @scenario Free SEAT_EVENT organization counts each span toward the limit */
  it("counts each span (events unit) for a free SEAT_EVENT organization", () => {
    const decision = resolveUsageMeter({
      isSeatEvent: true,
      isFree: true,
      hasValidLicenseOverride: false,
    });

    expect(decision.usageUnit).toBe("events");
  });

  /** @scenario Paid TIERED organization counts each trace as one unit */
  it("counts each trace (traces unit) for a paid TIERED organization", () => {
    const decision = resolveUsageMeter({
      isSeatEvent: false,
      isFree: false,
      hasValidLicenseOverride: false,
    });

    expect(decision.usageUnit).toBe("traces");
  });

  /** @scenario Paid SEAT_EVENT organization counts each span toward the limit */
  it("counts each span (events unit) for a paid SEAT_EVENT organization", () => {
    const decision = resolveUsageMeter({
      isSeatEvent: true,
      isFree: false,
      hasValidLicenseOverride: false,
    });

    expect(decision.usageUnit).toBe("events");
  });

  /** @scenario Licensed organization respects its own counting rule */
  it("uses the license-specified counting unit for a licensed organization", () => {
    const decision = resolveUsageMeter({
      isSeatEvent: true,
      licenseUsageUnit: "traces",
      isFree: true,
      hasValidLicenseOverride: true,
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
