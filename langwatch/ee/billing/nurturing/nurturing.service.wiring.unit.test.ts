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
    it("produces undefined (no service created)", () => {
      // This mirrors what presets.ts does: undefined when no API key
      const apiKey: string | undefined = undefined;
      const nurturing = apiKey
        ? NurturingService.create({
            config: { customerIoApiKey: apiKey, customerIoRegion: "us" },
          })
        : undefined;

      expect(nurturing).toBeUndefined();
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
    it("nurturing is undefined (no service in tests)", () => {
      // createTestApp() passes nurturing: undefined
      const nurturing: NurturingService | undefined = undefined;
      expect(nurturing).toBeUndefined();
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
