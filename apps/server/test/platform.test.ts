import type * as nodeOsModule from "node:os";

import { describe, expect, it, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("detectPlatform", () => {
  describe("when called on a supported platform", () => {
    it("returns the slug", async () => {
      vi.doMock("node:os", async () => {
        const real = await vi.importActual<typeof nodeOsModule>("node:os");
        return { ...real, platform: () => "darwin", arch: () => "arm64" };
      });
      const { detectPlatform } = await import("../src/shared/platform.ts");
      expect(detectPlatform()).toBe("darwin-arm64");
    });
  });

  describe("when called on Windows", () => {
    it("throws UnsupportedPlatformError with a clear message", async () => {
      vi.doMock("node:os", async () => {
        const real = await vi.importActual<typeof nodeOsModule>("node:os");
        return { ...real, platform: () => "win32", arch: () => "x64" };
      });
      const { detectPlatform, UnsupportedPlatformError } =
        await import("../src/shared/platform.ts");
      expect(() => detectPlatform()).toThrow(UnsupportedPlatformError);
      expect(() => detectPlatform()).toThrow(/WSL2/);
      expect(() => detectPlatform()).toThrow(/docker compose/);
    });
  });
});

describe("unsupportedHostReason", () => {
  describe("when Node is older than 24", () => {
    /** @scenario "Node older than 24 is refused with a clear message" */
    it("says LangWatch needs Node 24 or newer", async () => {
      const { unsupportedHostReason } = await import("../src/shared/platform.ts");
      expect(unsupportedHostReason({ nodeVersion: "22.11.0", platform: "darwin-arm64" })).toContain(
        "LangWatch needs Node 24 or newer",
      );
    });
  });

  describe("when Linux runs on musl", () => {
    /** @scenario "Linux on musl is refused with a clear message" */
    it("points at the Docker image instead", async () => {
      const { unsupportedHostReason } = await import("../src/shared/platform.ts");
      expect(
        unsupportedHostReason({ nodeVersion: "24.4.0", platform: "linux-x64-musl" }),
      ).toContain("Run the Docker image instead");
    });
  });

  describe("when Node 24 runs on a glibc Linux or macOS", () => {
    it("finds nothing to refuse", async () => {
      const { unsupportedHostReason } = await import("../src/shared/platform.ts");
      expect(unsupportedHostReason({ nodeVersion: "24.4.0", platform: "linux-arm64" })).toBeNull();
      expect(unsupportedHostReason({ nodeVersion: "v25.0.0", platform: "darwin-x64" })).toBeNull();
    });
  });
});
