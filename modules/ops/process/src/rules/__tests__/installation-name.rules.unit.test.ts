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

  describe("when the install has no web address", () => {
    it("falls back to the bare phrase", () => {
      expect(installationOf(undefined)).toBe("this installation");
      expect(installationOf("/ops/upgrades")).toBe("this installation");
      expect(installationOf("localhost:5560")).toBe("this installation");
    });
  });
});

describe("installationPageOf", () => {
  describe("when the install has a public URL", () => {
    it("builds an absolute link on it", () => {
      const page = installationPageOf({
        baseUrl: "https://langwatch.acme.example/",
        path: "/ops/operators",
      });

      expect(page.kind === "web" && page.url.toString()).toBe(
        "https://langwatch.acme.example/ops/operators",
      );
    });
  });

  describe("when the public address is a bare host and port", () => {
    it("answers that there is no web address, rather than throwing", () => {
      expect(installationPageOf({ baseUrl: "localhost:5560", path: "/ops/operators" })).toEqual({
        kind: "none",
      });
    });
  });
});
