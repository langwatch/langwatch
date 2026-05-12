import { describe, expect, it, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("detectPlatform", () => {
  describe("when called on a supported platform", () => {
    it("returns the slug", async () => {
      vi.doMock("node:os", async () => {
        const real = await vi.importActual<typeof import("node:os")>("node:os");
        return { ...real, platform: () => "darwin", arch: () => "arm64" };
      });
      const { detectPlatform } = await import("../src/shared/platform.ts");
      expect(detectPlatform()).toBe("darwin-arm64");
    });
  });

  describe("when called on Windows", () => {
    it("throws UnsupportedPlatformError with a clear message", async () => {
      vi.doMock("node:os", async () => {
        const real = await vi.importActual<typeof import("node:os")>("node:os");
        return { ...real, platform: () => "win32", arch: () => "x64" };
      });
      const { detectPlatform, UnsupportedPlatformError } = await import("../src/shared/platform.ts");
      expect(() => detectPlatform()).toThrow(UnsupportedPlatformError);
      expect(() => detectPlatform()).toThrow(/WSL2/);
      expect(() => detectPlatform()).toThrow(/docker compose/);
    });
  });
});
