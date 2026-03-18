import { describe, it, expect, vi } from "vitest";
import { NurturingService } from "./nurturing.service";

/**
 * Wiring unit tests for NurturingService app construction patterns.
 *
 * These test the service construction patterns that presets.ts uses
 * without importing the full App dependency graph (which requires
 * generated Prisma/ES types). The actual wiring in presets.ts follows
 * the same pattern tested here.
 */

// Suppress logger and captureException
vi.mock("../../../src/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

describe("NurturingService app wiring", () => {
  describe("when the app config includes a customerIoApiKey", () => {
    it("creates an active NurturingService instance", () => {
      const service = NurturingService.create({
        config: {
          customerIoApiKey: "test-key",
          customerIoRegion: "us",
        },
      });

      expect(service).toBeInstanceOf(NurturingService);
    });

    it("makes HTTP requests when methods are called", async () => {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 200 }),
      );
      const service = NurturingService.create({
        config: { customerIoApiKey: "test-key", customerIoRegion: "us" },
        fetchFn,
      });

      await service.identifyUser({ userId: "user-1", traits: { email: "a@b.com" } });

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the app config has no customerIoApiKey", () => {
    it("creates a null NurturingService that silently no-ops", async () => {
      // This mirrors what presets.ts does: NurturingService.createNull()
      const service = NurturingService.createNull();

      expect(service).toBeInstanceOf(NurturingService);
      await expect(
        service.identifyUser({ userId: "u1", traits: { email: "a@b.com" } }),
      ).resolves.toBeUndefined();
    });

    it("creates a no-op service when apiKey is falsy via create()", async () => {
      const fetchFn = vi.fn<typeof fetch>();
      // This mirrors what presets.ts does when config.customerIoApiKey is undefined
      const service = NurturingService.create({
        config: { customerIoApiKey: undefined, customerIoRegion: "us" },
        fetchFn,
      });

      await service.identifyUser({ userId: "u1", traits: { email: "a@b.com" } });

      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe("when the app config has no customerIoRegion", () => {
    it("defaults to the EU regional endpoint", async () => {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 200 }),
      );
      const service = NurturingService.create({
        config: { customerIoApiKey: "key", customerIoRegion: undefined },
        fetchFn,
      });

      await service.identifyUser({ userId: "user-1", traits: { email: "a@b.com" } });

      const [url] = fetchFn.mock.calls[0]!;
      expect(url).toContain("cdp-eu.customer.io");
    });
  });

  describe("when createTestApp is called", () => {
    it("NurturingService.createNull() produces a no-op instance", async () => {
      // createTestApp() uses NurturingService.createNull()
      const service = NurturingService.createNull();

      expect(service).toBeInstanceOf(NurturingService);
      await expect(
        service.identifyUser({ userId: "u1", traits: {} }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when region is set to 'eu'", () => {
    it("routes requests to the EU endpoint", async () => {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 200 }),
      );
      const service = NurturingService.create({
        config: { customerIoApiKey: "key", customerIoRegion: "eu" },
        fetchFn,
      });

      await service.identifyUser({ userId: "user-1", traits: { email: "a@b.com" } });

      const [url] = fetchFn.mock.calls[0]!;
      expect(url).toContain("cdp-eu.customer.io");
    });
  });
});
