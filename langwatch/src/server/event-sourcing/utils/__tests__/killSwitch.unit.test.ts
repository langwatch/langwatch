import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  generateKillSwitchKey,
  isComponentDisabled,
} from "../killSwitch";
import type { AggregateType } from "../../domain/aggregateType";

const TEST_AGGREGATE_TYPE = "trace" as AggregateType;

function createMockFeatureFlagService() {
  return {
    isEnabled: vi.fn().mockResolvedValue(false),
  };
}

function createMockLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    silent: vi.fn(),
  } as any;
}

describe("generateKillSwitchKey", () => {
  it("returns es-{aggregateType}-{componentType}-{componentName}-killswitch", () => {
    expect(
      generateKillSwitchKey(TEST_AGGREGATE_TYPE, "command", "recordSpan"),
    ).toBe("es-trace-command-recordSpan-killswitch");
  });

  it("works with projection componentType", () => {
    expect(
      generateKillSwitchKey(TEST_AGGREGATE_TYPE, "projection", "traceSummary"),
    ).toBe("es-trace-projection-traceSummary-killswitch");
  });

  it("works with mapProjection componentType", () => {
    expect(
      generateKillSwitchKey(TEST_AGGREGATE_TYPE, "mapProjection", "spanStorage"),
    ).toBe("es-trace-mapProjection-spanStorage-killswitch");
  });
});

describe("isComponentDisabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when no featureFlagService is provided", () => {
    it("returns false immediately", async () => {
      const result = await isComponentDisabled({
        featureFlagService: undefined,
        aggregateType: TEST_AGGREGATE_TYPE,
        componentType: "command",
        componentName: "test",
        tenantId: "tenant-1",
      });

      expect(result).toBe(false);
    });
  });

  describe("when featureFlagService returns true", () => {
    it("returns true", async () => {
      const ffs = createMockFeatureFlagService();
      ffs.isEnabled.mockResolvedValue(true);

      const result = await isComponentDisabled({
        featureFlagService: ffs as any,
        aggregateType: TEST_AGGREGATE_TYPE,
        componentType: "command",
        componentName: "recordSpan",
        tenantId: "tenant-1",
      });

      expect(result).toBe(true);
      expect(ffs.isEnabled).toHaveBeenCalledWith(
        "es-trace-command-recordSpan-killswitch",
        "tenant-1",
        false,
      );
    });

    it("logs debug message when logger is provided", async () => {
      const ffs = createMockFeatureFlagService();
      ffs.isEnabled.mockResolvedValue(true);
      const logger = createMockLogger();

      await isComponentDisabled({
        featureFlagService: ffs as any,
        aggregateType: TEST_AGGREGATE_TYPE,
        componentType: "command",
        componentName: "recordSpan",
        tenantId: "tenant-1",
        logger,
      });

      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("when featureFlagService returns false", () => {
    it("returns false", async () => {
      const ffs = createMockFeatureFlagService();
      ffs.isEnabled.mockResolvedValue(false);

      const result = await isComponentDisabled({
        featureFlagService: ffs as any,
        aggregateType: TEST_AGGREGATE_TYPE,
        componentType: "projection",
        componentName: "test",
        tenantId: "tenant-1",
      });

      expect(result).toBe(false);
    });
  });

  describe("when customKey is provided", () => {
    it("uses customKey instead of generated key", async () => {
      const ffs = createMockFeatureFlagService();

      await isComponentDisabled({
        featureFlagService: ffs as any,
        aggregateType: TEST_AGGREGATE_TYPE,
        componentType: "command",
        componentName: "test",
        tenantId: "tenant-1",
        customKey: "my-custom-flag",
      });

      expect(ffs.isEnabled).toHaveBeenCalledWith(
        "my-custom-flag",
        "tenant-1",
        false,
      );
    });
  });

  describe("when featureFlagService throws", () => {
    it("returns false as safe default", async () => {
      const ffs = createMockFeatureFlagService();
      ffs.isEnabled.mockRejectedValue(new Error("Feature flag service down"));

      const result = await isComponentDisabled({
        featureFlagService: ffs as any,
        aggregateType: TEST_AGGREGATE_TYPE,
        componentType: "command",
        componentName: "test",
        tenantId: "tenant-1",
      });

      expect(result).toBe(false);
    });

    it("logs warning when logger is provided", async () => {
      const ffs = createMockFeatureFlagService();
      ffs.isEnabled.mockRejectedValue(new Error("Service unavailable"));
      const logger = createMockLogger();

      await isComponentDisabled({
        featureFlagService: ffs as any,
        aggregateType: TEST_AGGREGATE_TYPE,
        componentType: "command",
        componentName: "test",
        tenantId: "tenant-1",
        logger,
      });

      expect(logger.warn).toHaveBeenCalled();
    });

    it("returns false without crash when no logger", async () => {
      const ffs = createMockFeatureFlagService();
      ffs.isEnabled.mockRejectedValue(new Error("Boom"));

      const result = await isComponentDisabled({
        featureFlagService: ffs as any,
        aggregateType: TEST_AGGREGATE_TYPE,
        componentType: "command",
        componentName: "test",
        tenantId: "tenant-1",
      });

      expect(result).toBe(false);
    });
  });
});
