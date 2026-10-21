import { appendFileSync, utimesSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { moduleClassesRule } from "../../src/rules/module-classes.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {}, contract: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent.service.ts";
const APP = "modules/agent/process/src/app/agent.app.ts";
const MIGRATION = "modules/agent/process/src/migrations/agent-import.legacy.migration.ts";
const REPOSITORY = "modules/agent/process/src/repositories/agent.repository.ts";
const PRISMA_REPOSITORY =
  "modules/agent/process/src/repositories/prisma/prisma.agent.repository.ts";
const CONTRACT_SERVICE = "modules/agent/contract/src/agent.service.ts";
const CONTRACT_APP = "modules/agent/contract/src/agent.app.ts";
const RULES = "modules/agent/process/src/rules/agent.rules.ts";

const WELL_FORMED_SERVICE = [
  "export class AgentService {",
  "  private constructor() {}",
  "  static create() { return new AgentService(); }",
  "}",
].join("\n");

function report(code, filename = SERVICE) {
  return runRule(moduleClassesRule, { code, cwd: workspace.cwd, filename });
}

function located(found) {
  return found.map((entry) => [entry.messageId, entry.line]);
}

describe("given a process service module", () => {
  describe("when it exports a standalone function beside its Service class", () => {
    /** @scenario "A standalone exported function is reported by name and line" */
    it("reports standalone on the function's line, naming it and the class it belongs on", () => {
      const found = report(`${WELL_FORMED_SERVICE}\nexport function run() { return 1; }`);

      expect(located(found)).toEqual([["standalone", 5]]);
      expect(found[0].data).toMatchObject({ destination: "of `AgentService`", name: "run" });
      expect(found[0].message).toContain("`rules/` folder");
    });

    /** @scenario "A standalone exported function is reported by name and line" */
    it("reports an exported arrow const the same way", () => {
      const found = report(`${WELL_FORMED_SERVICE}\nexport const run = () => 1;`);

      expect(located(found)).toEqual([["standalone", 5]]);
      expect(found[0].data.name).toBe("run");
    });
  });

  describe("when it exports no concrete *Service class", () => {
    /** @scenario "A module file missing its class is reported" */
    it("reports missingConcrete, including when the only Service class is abstract", () => {
      expect(located(report("export class Helper {}"))).toEqual([["missingConcrete", 1]]);
      expect(located(report("export abstract class AgentService {}"))).toEqual([
        ["missingConcrete", 1],
      ]);
    });
  });

  describe("when the Service class has no static create method", () => {
    /** @scenario "A concrete class without static create is reported" */
    it("reports create on the class line", () => {
      const found = report("\nexport class AgentService {}");

      expect(located(found)).toEqual([["create", 2]]);
      expect(found[0].message).toContain(
        "a `static create(...)` method returning `new AgentService(...)`",
      );
    });

    /** @scenario "A service's create is a method, a Prisma backend may inherit it" */
    it("does not accept an inherited factory property as a service's create", () => {
      const found = report(
        "export class AgentService { static readonly create = this.factory(() => new AgentService()); }",
      );

      expect(located(found)).toEqual([["create", 1]]);
    });
  });

  describe("when the Service class has static create and a constructor that is not private", () => {
    /** @scenario "A constructor that is not private beside static create is reported" */
    it("reports publicConstructor on an explicit public constructor's line", () => {
      const found = report(
        "export class AgentService {\n  constructor() {}\n  static create() { return new AgentService(); }\n}",
      );

      expect(located(found)).toEqual([["publicConstructor", 2]]);
      expect(found[0].data.name).toBe("AgentService");
    });

    /** @scenario "A constructor that is not private beside static create is reported" */
    it("reports publicConstructor on the class when no constructor is declared at all", () => {
      const found = report(
        "\n\nexport class AgentService { static create() { return new AgentService(); } }",
      );

      expect(located(found)).toEqual([["publicConstructor", 3]]);
      expect(found[0].message).toContain(
        "write `private constructor() {}` when the class has none",
      );
    });
  });

  describe("when the module follows the shape", () => {
    /** @scenario "A well-formed module class is left alone" */
    it("reports nothing", () => {
      expect(report(WELL_FORMED_SERVICE)).toEqual([]);
    });
  });
});

describe("given a repository backend module", () => {
  describe("when the class inherits create from PrismaRepository.for", () => {
    /** @scenario "A service's create is a method, a Prisma backend may inherit it" */
    it("accepts the inherited factory property", () => {
      expect(
        report(
          "export class PrismaAgentRepository { static readonly create = this.factory((prisma) => new PrismaAgentRepository(prisma)); }",
          PRISMA_REPOSITORY,
        ),
      ).toEqual([]);
    });
  });

  describe("when the concrete class has no create at all", () => {
    /** @scenario "A concrete class without static create is reported" */
    it("reports create naming both spellings a backend may use", () => {
      const found = report("export class PrismaAgentRepository {}", PRISMA_REPOSITORY);

      expect(located(found)).toEqual([["create", 1]]);
      expect(found[0].message).toContain("this.factory(...)");
    });
  });
});

describe("given an interface file", () => {
  describe("when a repository interface file exports a concrete class", () => {
    /** @scenario "An interface file without its interface is reported" */
    it("reports missingDeclared naming the Repository suffix", () => {
      const found = report("export class AgentRepository {}", REPOSITORY);

      expect(located(found)).toEqual([["missingDeclared", 1]]);
      expect(found[0].data.suffix).toBe("Repository");
    });
  });

  describe("when a repository, contract service or contract app file exports its interface", () => {
    /** @scenario "A well-formed module class is left alone" */
    it("reports nothing for an interface or an abstract class", () => {
      expect(report("export interface AgentRepository {}", REPOSITORY)).toEqual([]);
      expect(report("export abstract class AgentService {}", CONTRACT_SERVICE)).toEqual([]);
      expect(report("export interface AgentModule {}", CONTRACT_APP)).toEqual([]);
    });
  });

  describe("when a contract service file exports a concrete class", () => {
    /** @scenario "An interface file without its interface is reported" */
    it("reports missingDeclared naming the Service suffix", () => {
      const found = report("export class AgentService {}", CONTRACT_SERVICE);

      expect(located(found)).toEqual([["missingDeclared", 1]]);
      expect(found[0].data.suffix).toBe("Service");
    });
  });
});

describe("given a process app or migration module", () => {
  describe("when the concrete class has no static create", () => {
    /** @scenario "A concrete class without static create is reported" */
    it("reports create for an App and for a Migration", () => {
      expect(located(report("export class ComposedAgentModule {}", APP))).toEqual([["create", 1]]);
      expect(located(report("export class LegacyAgentMigration {}", MIGRATION))).toEqual([
        ["create", 1],
      ]);
    });
  });

  describe("when the concrete class exposes static create", () => {
    /** @scenario "A well-formed module class is left alone" */
    it("reports nothing, leaving the constructor check to services", () => {
      expect(
        report(
          "export class ComposedAgentModule { static create() { return new ComposedAgentModule(); } }",
          APP,
        ),
      ).toEqual([]);
    });
  });
});

describe("given a file that is not a module class artifact", () => {
  /** @scenario "A file that is no module class artifact is left alone" */
  it("reports nothing for a rules module exporting functions", () => {
    expect(report("export function isActive() { return true; }", RULES)).toEqual([]);
  });
});

// ADR-181: `relay` opts into the feature layout; `eventing` is a framework that has not.
const framework = createFixtureWorkspace({
  files: {
    "packages/relay/package.json": JSON.stringify({
      name: "@langwatch/relay",
      exports: { ".": { default: "./src/index.ts" } },
      langwatch: { group: "framework", layout: "features" },
    }),
    "packages/eventing/package.json": JSON.stringify({
      name: "@langwatch/eventing",
      langwatch: { group: "framework" },
    }),
    "packages/relay/src/index.ts": [
      'export { GroupStagingScripts } from "./features/keyspace/repositories/redis/redis.group-staging.repository.ts";',
      'export * from "./app/relay.app.ts";',
    ].join("\n"),
    "packages/relay/src/app/relay.app.ts":
      "export class RelayProcessor {\n  constructor(readonly name: string) {}\n}\n",
  },
});

afterAll(() => framework.cleanup());

function frameworkReport(code, filename) {
  return located(runRule(moduleClassesRule, { code, cwd: framework.cwd, filename }));
}

const RELAY = "packages/relay/src";

describe("given an opted-in framework package", () => {
  describe("when a concern's service has a public constructor beside static create", () => {
    /** @scenario "A framework class takes the module's shape unless an entry publishes it" */
    it("reports publicConstructor", () => {
      const code = [
        "export class ClaimService {",
        "  constructor() {}",
        "  static create() { return new ClaimService(); }",
        "}",
      ].join("\n");
      expect(frameworkReport(code, `${RELAY}/features/claim/services/claim.service.ts`)).toEqual([
        ["publicConstructor", 2],
      ]);
    });
  });

  describe("when a tier repository nobody publishes has no create", () => {
    /** @scenario "A framework class takes the module's shape unless an entry publishes it" */
    it("reports create", () => {
      const code = "export class RedisClaimRepository {\n  constructor() {}\n}";
      expect(
        frameworkReport(
          code,
          `${RELAY}/features/claim/repositories/redis/redis.claim.repository.ts`,
        ),
      ).toEqual([["create", 1]]);
    });
  });

  describe("when an entry publishes the class by name or through export *", () => {
    /** @scenario "A framework class takes the module's shape unless an entry publishes it" */
    it("keeps its name and its public constructor", () => {
      const staging =
        "export class GroupStagingScripts {\n  constructor(readonly name: string) {}\n}";
      expect(
        frameworkReport(
          staging,
          `${RELAY}/features/keyspace/repositories/redis/redis.group-staging.repository.ts`,
        ),
      ).toEqual([]);
      const processor = "export class RelayProcessor {\n  constructor(readonly name: string) {}\n}";
      expect(frameworkReport(processor, `${RELAY}/app/relay.app.ts`)).toEqual([]);
    });
  });
  describe("when an entry starts publishing the class after a first lint", () => {
    /** @scenario "A framework class takes the module's shape unless an entry publishes it" */
    it("reads the entry again instead of reusing the names it read before", () => {
      const filename = `${RELAY}/features/late/services/late.service.ts`;
      const code = [
        "export class LateService {",
        "  constructor() {}",
        "  static create() { return new LateService(); }",
        "}",
      ].join("\n");
      expect(frameworkReport(code, filename)).toEqual([["publicConstructor", 2]]);

      const entry = join(framework.cwd, RELAY, "index.ts");
      appendFileSync(
        entry,
        'export { LateService } from "./features/late/services/late.service.ts";\n',
      );
      const later = new Date(Date.now() + 60_000);
      utimesSync(entry, later, later);
      expect(frameworkReport(code, filename)).toEqual([]);
    });
  });
});

describe("given a framework package that has not opted in", () => {
  /** @scenario "A framework package that has not opted in is left alone by the layered rules" */
  it("reports nothing for a service class without create", () => {
    expect(
      frameworkReport(
        "export class ClaimService {}",
        "packages/eventing/src/services/claim.service.ts",
      ),
    ).toEqual([]);
  });
});
