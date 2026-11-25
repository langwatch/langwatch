/** The one deployment fact the scope rules need from the HTML shell. */

import { createPublicAppConfigMetaTag } from "@langwatch/config/public-app-config";
import { describe, expect, it } from "vitest";

import { readUiDemoProjectSlug } from "../ui-scope-capability";

describe("given the deployment's demo project slug", () => {
  describe("when the HTML shell declares one", () => {
    it("reads it out of the shell", () => {
      const meta = createPublicAppConfigMetaTag({
        authz: { demoProjectSlug: "demo-project" },
      });
      const documentRoot = {
        querySelector: () => ({
          getAttribute: () => /content="([^"]+)"/.exec(meta)?.[1] ?? null,
        }),
      };

      expect(readUiDemoProjectSlug(documentRoot)).toBe("demo-project");
    });
  });

  describe("when the authz slice names none", () => {
    it("reads no demo project", () => {
      const meta = createPublicAppConfigMetaTag({ authz: {} });
      const documentRoot = {
        querySelector: () => ({
          getAttribute: () => /content="([^"]+)"/.exec(meta)?.[1] ?? null,
        }),
      };

      expect(readUiDemoProjectSlug(documentRoot)).toBeUndefined();
    });
  });

  describe("when the shell declares none", () => {
    it("reads no demo project rather than failing the whole session", () => {
      expect(readUiDemoProjectSlug({ querySelector: () => null })).toBeUndefined();
    });
  });
});
