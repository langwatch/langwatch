import { afterAll, describe, expect, it } from "vitest";

import { serviceDependenciesRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent.service.ts";

function report(code) {
  return runRule(serviceDependenciesRule, { code, cwd: workspace.cwd, filename: SERVICE });
}

describe("given a strict feature service module", () => {
  describe("when it imports a database client directly", () => {
    /** @scenario "A service importing a database client is reported" */
    it("reports databaseClient naming the client and the target repository", () => {
      const found = report('import { PrismaClient } from "@prisma/client";');

      expect(found.map((entry) => entry.messageId)).toEqual(["databaseClient"]);
      expect(found[0].message).toContain("`@prisma/client`");
      expect(found[0].message).toContain("`repositories/agent.repository.ts`");
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
      expect(found[0].message).toContain("Depend on `ProjectService` instead");
    });
  });

  describe("when it imports its own repository", () => {
    /** @scenario "Module service ownership follows both process and server layouts" */
    it.each([
      "modules/agent/process",
      "modules/agent/server",
      "enterprise/modules/agent/process",
      "enterprise/modules/agent/server",
    ])("keeps local repositories and rejects peer repositories in %s", (owner) => {
      const filename = `${owner}/src/services/agent.service.ts`;
      const local = runRule(serviceDependenciesRule, {
        code: 'import { AgentRepository } from "../repositories/agent.repository";',
        cwd: workspace.cwd,
        filename,
      });
      const foreign = runRule(serviceDependenciesRule, {
        code: 'import { ProjectRepository } from "../../../../project/process/src/repositories/project.repository";',
        cwd: workspace.cwd,
        filename,
      });

      expect(local).toEqual([]);
      expect(foreign.map((entry) => entry.messageId)).toEqual(["foreignRepository"]);
    });

    /** @scenario "A service's own repository import is left alone" */
    it("reports nothing", () => {
      expect(report('import { AgentRepository } from "../repositories/agent.repository";')).toEqual(
        [],
      );
    });

    it("allows the feature-local repository alias", () => {
      expect(
        report('import type { AgentRepository } from "#repositories/agent.repository";'),
      ).toEqual([]);
    });
  });

  describe("when it recovers the global application graph", () => {
    /** @scenario "Recovering the global application from a service is reported" */
    it("reports globalApplication naming the recovery call", () => {
      const found = report('import { getApp } from "../../app-layer/app";');

      expect(found.map((entry) => entry.messageId)).toEqual(["globalApplication"]);
      expect(found[0].message).toContain("`getApp`");
      expect(found[0].message).toContain("calling `getApp()`");
    });
  });
});
