import { describe, expect, it } from "vitest";

import { installationOf } from "../installation-name.rules.ts";

describe("installationOf", () => {
  describe("when the install has a public URL", () => {
    it("names it by its host", () => {
      expect(installationOf("https://langwatch.acme.example/ops/upgrades")).toBe(
        "langwatch.acme.example",
      );
    });
  });

  describe("when the install has no public URL", () => {
    it("falls back to the bare phrase", () => {
      expect(installationOf(undefined)).toBe("this installation");
      expect(installationOf("/ops/upgrades")).toBe("this installation");
    });
  });
});
