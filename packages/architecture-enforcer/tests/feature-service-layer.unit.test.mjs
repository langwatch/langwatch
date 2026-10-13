import { boundaryRule, moduleClassesRule } from "@langwatch/oxlint-rules";
import { createFixtureWorkspace, runRule } from "@langwatch/oxlint-rules/testing";
import { afterAll, describe, expect, it } from "vitest";

const workspace = createFixtureWorkspace({
  features: {
    agent: { layoutVersion: 0, roles: { contract: {}, process: {} } },
    project: { layoutVersion: 0, roles: { contract: {}, process: {} } },
  },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent.service.ts";
const APP = "modules/agent/process/src/app/agent.app.ts";
const MIGRATION = "modules/agent/process/src/migrations/agent-import.legacy.migration.ts";
const REPOSITORY_INTERFACE = "modules/agent/process/src/repositories/agent.repository.ts";

const WELL_FORMED_SERVICE = [
  "export class AgentService {",
  "  private constructor() {}",
  "  static create() { return new AgentService(); }",
  "}",
].join("\n");

function check(rule, filename, code) {
  return runRule(rule, { code, cwd: workspace.cwd, filename });
}

function ids(rule, filename, code) {
  return check(rule, filename, code).map((found) => found.messageId);
}

describe("given a feature server service module", () => {
  describe("when it exports a standalone service factory", () => {
    /** @scenario "Feature services are classes" */
    it("rejects the factory, pointing at the class it belongs on", () => {
      const found = check(
        moduleClassesRule,
        SERVICE,
        `${WELL_FORMED_SERVICE}\nexport function createAgentService() { return AgentService.create(); }`,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["standalone"]);
      expect(found[0].data).toMatchObject({ name: "createAgentService" });
    });

    /** @scenario "Feature services are classes" */
    it("rejects a service module that exports no class at all", () => {
      expect(
        ids(moduleClassesRule, SERVICE, "export const createAgentService = () => ({});"),
      ).toEqual(["standalone", "missingConcrete"]);
    });
  });

  describe("when it exports a service class without static create", () => {
    /** @scenario "Feature services are classes" */
    it("rejects the class", () => {
      expect(
        ids(moduleClassesRule, SERVICE, "export class AgentService { private constructor() {} }"),
      ).toEqual(["create"]);
    });
  });

  describe("when the class uses a private pure module-local function", () => {
    /** @scenario "Feature classes may use private pure helpers" */
    it("accepts the helper as an implementation detail", () => {
      const code = [
        "function slug(name: string) { return name.trim().toLowerCase(); }",
        "const PREFIX = 'agent-';",
        "export class AgentService {",
        "  private constructor() {}",
        "  static create() { return new AgentService(); }",
        "  nameOf(name: string) { return PREFIX + slug(name); }",
        "}",
      ].join("\n");

      expect(check(moduleClassesRule, SERVICE, code)).toEqual([]);
    });
  });
});

describe("given a behaviour-bearing module of a layout-version-0 feature", () => {
  describe("when a service, app or migration carries no class", () => {
    /** @scenario "Behaviour-bearing modules are classes" */
    it("requires the class kind for each of them", () => {
      expect(ids(moduleClassesRule, SERVICE, "export const run = () => 1;")).toContain(
        "missingConcrete",
      );
      expect(ids(moduleClassesRule, APP, "export const run = () => 1;")).toContain(
        "missingConcrete",
      );
      expect(ids(moduleClassesRule, MIGRATION, "export const run = () => 1;")).toContain(
        "missingConcrete",
      );
    });
  });

  describe("when a concrete runtime class has no static create", () => {
    /** @scenario "Behaviour-bearing modules are classes" */
    it("requires static create on an app and on a migration", () => {
      expect(ids(moduleClassesRule, APP, "export class AgentModule {}")).toEqual(["create"]);
      expect(ids(moduleClassesRule, MIGRATION, "export class AgentImportMigration {}")).toEqual([
        "create",
      ]);
    });
  });

  describe("when a repository interface file exports a concrete class", () => {
    /** @scenario "Behaviour-bearing modules are classes" */
    it("requires the declared kind, an interface, rather than a class", () => {
      expect(
        ids(moduleClassesRule, REPOSITORY_INTERFACE, "export class AgentRepository {}"),
      ).toEqual(["missingDeclared"]);
    });
  });

  describe("when a standalone factory sits where the class belongs", () => {
    /** @scenario "Behaviour-bearing modules are classes" */
    it("does not let the factory stand in for the class", () => {
      expect(
        ids(
          moduleClassesRule,
          SERVICE,
          `${WELL_FORMED_SERVICE}\nexport const createAgentService = () => AgentService.create();`,
        ),
      ).toEqual(["standalone"]);
    });
  });
});

describe("given a service that names another feature's process package", () => {
  describe("when Oxlint checks the service module", () => {
    /** @scenario "Services do not reach through another domain's repository" */
    it("rejects the dependency and directs the service to the owner's contract Api", () => {
      const found = check(
        boundaryRule,
        SERVICE,
        'import { ProjectRepository } from "@langwatch/project-process";\nexport { ProjectRepository };',
      ).filter((entry) => entry.messageId !== "undeclaredDependency");

      expect(found.map((entry) => entry.messageId)).toEqual(["crossModuleProcess"]);
      expect(found[0].message).toContain("ProjectApi");
      expect(found[0].message).toContain("@langwatch/project-contract");
    });
  });
});
