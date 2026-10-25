import { describe, expect, it } from "vitest";

import { installationOf, installationPageOf } from "../installation-name.rules.ts";

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

    it("treats a bare host and port as no web address", () => {
      expect(installationOf("localhost:5560")).toBe("this installation");
      expect(installationPageOf({ baseUrl: "localhost:5560", path: "/ops/operators" })).toEqual({
        kind: "none",
      });
    });
  });

  describe("when a page of the install is linked", () => {
    it("builds an absolute link on the public address", () => {
      const page = installationPageOf({
        baseUrl: "https://langwatch.acme.example/",
        path: "/ops/operators",
      });

      expect(page.kind === "web" && page.url.toString()).toBe(
        "https://langwatch.acme.example/ops/operators",
      );
    });
  });
});
