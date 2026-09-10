import { afterAll, describe, expect, it } from "vitest";
import { moduleAppOnlyAcrossPackagesRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: {
    department: { layoutVersion: 0, roles: { contract: {}, server: {} } },
    governance: { layoutVersion: 0, roles: { contract: {}, server: {} }, enterprise: true },
  },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(moduleAppOnlyAcrossPackagesRule, { code, cwd: workspace.cwd, filename });
}

describe("given a file outside a module's server package", () => {
  describe("when it imports a repository and a service from the server package by name", () => {
    /** @scenario "Importing a repository and a service across packages is banned" */
    it("reports reachThroughApi for each disallowed identifier", () => {
      const found = report(
        'import { PrismaDepartmentRepository, DepartmentService } from "@langwatch/enterprise-governance-server";',
        "modules/department/server/src/app/department.app.ts",
      );

      expect(found).toHaveLength(2);
      expect(found.map((entry) => entry.messageId)).toEqual(["reachThroughApi", "reachThroughApi"]);
      expect(found.map((entry) => entry.data.name).sort()).toEqual([
        "DepartmentService",
        "PrismaDepartmentRepository",
      ]);
      expect(found[0].data.module).toBe("governance");
    });
  });

  describe("when it imports the installer", () => {
    /** @scenario "Importing the installer across packages is allowed" */
    it("reports nothing", () => {
      const found = report(
        'import { GovernanceServer } from "@langwatch/enterprise-governance-server";',
        "modules/department/server/src/app/department.app.ts",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it imports a transport declaration", () => {
    /** @scenario "Importing a transport declaration across packages is allowed" */
    it("reports nothing", () => {
      const found = report(
        'import { governanceTrpc } from "@langwatch/enterprise-governance-server";',
        "modules/department/server/src/app/department.app.ts",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it imports the Infrastructure type", () => {
    /** @scenario "A type-only Infrastructure import across packages is allowed" */
    it("reports nothing", () => {
      const found = report(
        'import type { GovernanceInfrastructure } from "@langwatch/enterprise-governance-server";',
        "modules/department/server/src/app/department.app.ts",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when a non-test file imports a fixture", () => {
    /** @scenario "A fixture import outside a test file is banned" */
    it("reports reachThroughApi", () => {
      const found = report(
        'import { GovernanceFixture } from "@langwatch/enterprise-governance-server";',
        "modules/department/server/src/app/department.app.ts",
      );

      expect(found.map((entry) => entry.data.name)).toEqual(["GovernanceFixture"]);
    });
  });

  describe("when a test file imports a fixture", () => {
    /** @scenario "A fixture import inside a test file is allowed" */
    it("reports nothing", () => {
      const found = report(
        'import { GovernanceFixture } from "@langwatch/enterprise-governance-server";',
        "modules/department/server/src/app/__tests__/department.integration.test.ts",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it crosses via a relative path into another module's server package", () => {
    /** @scenario "A relative import into another module's server package is banned" */
    it("reports reachThroughApi", () => {
      const found = report(
        'import { DepartmentService } from "../../../../governance/server/src/app/department.service.ts";',
        "modules/department/server/src/app/department.app.ts",
      );

      expect(found.map((entry) => entry.data.name)).toEqual(["DepartmentService"]);
    });
  });
});

describe("given a file inside the module's own server package", () => {
  describe("when it imports its own repository by package name", () => {
    /** @scenario "A self-import of the module's own server package is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        'import { PrismaDepartmentRepository } from "@langwatch/department-server";',
        "modules/department/server/src/app/department.app.ts",
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a file that imports an unrelated package", () => {
  describe("when the specifier is not a module's server package", () => {
    /** @scenario "An unrelated import is allowed" */
    it("reports nothing", () => {
      expect(
        report('import { z } from "zod";', "modules/department/server/src/app/department.app.ts"),
      ).toEqual([]);
    });
  });
});
