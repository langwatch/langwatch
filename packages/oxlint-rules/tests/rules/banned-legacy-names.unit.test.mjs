import { afterAll, describe, expect, it } from "vitest";
import { bannedLegacyNamesRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
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
        "modules/agent/process/src/services/agent.service.ts",
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
        "modules/agent/process/src/services/agent.service.ts",
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
        "modules/agent/process/src/services/agent.service.ts",
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
          "modules/agent/process/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });
});

describe("given a file that calls a deleted composition builder", () => {
  describe("when it calls withPersistence or the singular withModule", () => {
    /** @scenario "A deleted builder is refused where it is called" */
    it("reports bannedLegacyName naming what to call instead", () => {
      const found = report(
        "await createApp({}).withPersistence('memory', {}).withModule(x).boot();",
        "apps/api/src/app/api-production.composition.ts",
      );

      expect(found.map((entry) => entry.data.name).toSorted()).toEqual(["withModule", "withPersistence"]);
      expect(found.find((entry) => entry.data.name === "withPersistence").message).toContain(
        "refuses at boot",
      );
      expect(found.find((entry) => entry.data.name === "withModule").message).toContain(
        "withModules([...])",
      );
    });
  });

  describe("when it names a member record it should have declared", () => {
    /** @scenario "A deleted builder is refused where it is called" */
    it("reports withInfrastructure and createTestInfrastructure", () => {
      expect(report("app.withInfrastructure(pool);", "apps/api/src/app/api-production.composition.ts").map((e) => e.data.name)).toEqual([
        "withInfrastructure",
      ]);
      expect(
        report('import { createTestInfrastructure } from "@langwatch/test-harness";', "apps/api/src/app/api-production.composition.ts").map(
          (e) => e.data.name,
        ),
      ).toEqual(["createTestInfrastructure"]);
    });
  });

  describe("when it imports the deleted single-call process bootstrap", () => {
    /** @scenario "A deleted process bootstrap is refused where it is imported" */
    it("reports createProcess naming the Server and createApp replacement", () => {
      const found = report(
        'import { createProcess } from "@langwatch/process-stores";',
        "apps/api/src/app/api-production.composition.ts",
      );

      expect(found.map((entry) => entry.data.name)).toEqual(["createProcess"]);
      expect(found[0].message).toContain("Server.start");
    });
  });
});
