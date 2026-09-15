import { afterAll, describe, expect, it } from "vitest";
import { transportImportsARepositoryRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const TRANSPORT = "modules/agent/server/src/transport/agent.rest.ts";

function report(code, filename = TRANSPORT) {
  return runRule(transportImportsARepositoryRule, { code, cwd: workspace.cwd, filename });
}

describe("given a transport file", () => {
  describe("when it imports from the repositories folder", () => {
    /** @scenario "A route importing from repositories bypasses the app" */
    it("reports repositoryFolder", () => {
      const found = report("import { findAll } from '../repositories/agent.repository';");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("repositoryFolder");
      expect(found[0].data.specifier).toBe("../repositories/agent.repository");
    });
  });

  describe("when it imports from a repositories folder several levels up", () => {
    /** @scenario "A route reaching a repositories folder at any depth bypasses the app" */
    it("reports repositoryFolder", () => {
      const found = report(
        "import { findAll } from '../../../repositories/prisma/agent.repository';",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("repositoryFolder");
    });
  });

  describe("when it imports a repository module held outside the folder", () => {
    /** @scenario "A route importing a repository module bypasses the app" */
    it("reports repositoryModule", () => {
      const found = report("import { findAll } from './agent.repository';");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("repositoryModule");
    });
  });

  describe("when it imports a value whose name ends in Repository", () => {
    /** @scenario "A route holding a repository value bypasses the app" */
    it("reports repositoryName", () => {
      const found = report("import { agentRepository as AgentRepository } from '../agent.server';");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("repositoryName");
      expect(found[0].data.name).toBe("agentRepository");
    });
  });

  describe("when it imports a Repository type only", () => {
    /** @scenario "A type-only repository name is erased and is allowed" */
    it("reports nothing", () => {
      expect(report("import type { AgentRepository } from '../agent.server';")).toEqual([]);
    });
  });

  describe("when it imports the module's app", () => {
    /** @scenario "A route reaching the module app is allowed" */
    it("reports nothing", () => {
      expect(report("import { AgentServer } from '../agent.server';")).toEqual([]);
    });
  });
});

describe("given a service file", () => {
  describe("when it imports from the repositories folder", () => {
    /** @scenario "A service importing a repository is not governed" */
    it("reports nothing", () => {
      expect(
        report(
          "import { findAll } from '../repositories/agent.repository';",
          "modules/agent/server/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });
});

describe("given a transport test file", () => {
  describe("when it imports a memory repository to stand the route up", () => {
    /** @scenario "A transport test building a repository fixture is not governed" */
    it("reports nothing", () => {
      expect(
        report(
          "import { InMemoryAgentRepository } from '../../repositories/memory/memory.agent.repository';",
          "modules/agent/server/src/transport/__tests__/agent-rest.integration.test.ts",
        ),
      ).toEqual([]);
    });
  });
});
