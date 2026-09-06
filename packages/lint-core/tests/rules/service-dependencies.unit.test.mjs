import { afterAll, describe, expect, it } from "vitest";
import { serviceDependenciesRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "packages/features/agent/server/src/services/agent.service.ts";

function report(code) {
  return runRule(serviceDependenciesRule, { code, cwd: workspace.cwd, filename: SERVICE });
}

describe("given a strict feature service module", () => {
  describe("when it imports a database client directly", () => {
    /** @scenario "A service importing a database client is reported" */
    it("reports databaseClient", () => {
      const found = report('import { PrismaClient } from "@prisma/client";');

      expect(found.map((entry) => entry.messageId)).toEqual(["databaseClient"]);
    });
  });

  describe("when it imports another subject's repository", () => {
    /** @scenario "A foreign repository import is reported with the specifier" */
    it("reports foreignRepository with the specifier", () => {
      // `~/` resolves to nothing (the deleted platform application's alias
      // root), which is exactly what makes this repository target
      // unresolvable rather than silently pointed at a path that isn't
      // there — the same shape as an import escaping the owning package.
      const found = report(
        'import { ProjectRepository } from "~/project/repositories/project.repository";',
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["foreignRepository"]);
      expect(found[0].data.specifier).toBe("~/project/repositories/project.repository");
    });
  });

  describe("when it imports its own repository", () => {
    /** @scenario "A service's own repository import is left alone" */
    it("reports nothing", () => {
      expect(report('import { AgentRepository } from "../repositories/agent.repository";')).toEqual(
        [],
      );
    });
  });

  describe("when it recovers the global application graph", () => {
    /** @scenario "Recovering the global application from a service is reported" */
    it("reports globalApplication", () => {
      const found = report('import { getApp } from "../../app-layer/app";');

      expect(found.map((entry) => entry.messageId)).toEqual(["globalApplication"]);
    });
  });
});
