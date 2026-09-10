import { afterAll, describe, expect, it } from "vitest";
import { bannedLegacyNamesRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(bannedLegacyNamesRule, { code, cwd: workspace.cwd, filename });
}

describe("given any source file", () => {
  describe("when it imports a banned legacy name", () => {
    /** @scenario "Importing a deleted transport helper is banned" */
    it("reports bannedLegacyName", () => {
      const found = report(
        "import { createServiceApp } from '@langwatch/api';",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("bannedLegacyName");
      expect(found[0].data.name).toBe("createServiceApp");
    });
  });

  describe("when it declares a function under a banned legacy name", () => {
    /** @scenario "Redeclaring a deleted transport helper is banned" */
    it("reports bannedLegacyName", () => {
      const found = report(
        "function mountProjectTransport() {}",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("bannedLegacyName");
      expect(found[0].data.name).toBe("mountProjectTransport");
    });
  });

  describe("when it declares a class under a banned legacy name", () => {
    /** @scenario "Redeclaring a deleted transport class is banned" */
    it("reports bannedLegacyName", () => {
      const found = report(
        "class SecuredApp {}",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("bannedLegacyName");
      expect(found[0].data.name).toBe("SecuredApp");
    });
  });

  describe("when it imports an unrelated name", () => {
    /** @scenario "An unrelated import is allowed" */
    it("reports nothing", () => {
      expect(
        report(
          "import { defineRestRouter } from '@langwatch/api';",
          "modules/agent/server/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });
});
