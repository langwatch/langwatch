import { afterAll, describe, expect, it } from "vitest";
import { boundaryRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: {
    agent: { layoutVersion: 0, roles: { contract: {}, server: {}, web: {} } },
    project: { layoutVersion: 0, roles: { contract: {}, server: {}, web: {} } },
  },
});

afterAll(() => workspace.cleanup());

function report(filename, code) {
  return runRule(boundaryRule, { code, cwd: workspace.cwd, filename });
}

describe("given package-boundaries", () => {
  it("allows an exact catalogue-declared cross-feature web dependency", () => {
    const fixture = createFixtureWorkspace({
      features: {
        annotation: { layoutVersion: 0, roles: { web: {} } },
        organization: {
          layoutVersion: 0,
          roles: { web: { exports: ["./personal-workspace-features"] } },
        },
      },
    });
    fixture.write(
      "apps/ui/src/features/catalogue.json",
      JSON.stringify({
        version: 0,
        features: [
          {
            id: "annotations",
            root: "annotation",
            uses: {
              screens: [],
              surfaces: ["@langwatch/organization-web/personal-workspace-features"],
            },
          },
        ],
      }),
    );

    try {
      expect(
        runRule(boundaryRule, {
          cwd: fixture.cwd,
          filename: "modules/annotation/web/src/behavior/gate.ts",
          code: 'import { client } from "@langwatch/organization-web/personal-workspace-features";',
        }),
      ).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects an undeclared cross-feature web dependency", () => {
    const fixture = createFixtureWorkspace({
      features: {
        annotation: { layoutVersion: 0, roles: { web: {} } },
        organization: {
          layoutVersion: 0,
          roles: { web: { exports: ["./personal-workspace-features"] } },
        },
      },
    });
    fixture.write(
      "apps/ui/src/features/catalogue.json",
      JSON.stringify({ version: 0, features: [] }),
    );

    try {
      expect(
        runRule(boundaryRule, {
          cwd: fixture.cwd,
          filename: "modules/annotation/web/src/behavior/gate.ts",
          code: 'import { client } from "@langwatch/organization-web/personal-workspace-features";',
        }).map((entry) => entry.messageId),
      ).toContain("crossFeature");
    } finally {
      fixture.cleanup();
    }
  });

  describe("when a web package imports a different feature's server package", () => {
    /** @scenario "A web package importing another feature's server is reported as webImportsServer" */
    it("reports webImportsServer", () => {
      const found = report(
        "modules/agent/web/src/behavior/agent-api.ts",
        'import { ProjectService } from "@langwatch/project-server";',
      );

      expect(found.map((e) => e.messageId)).toContain("webImportsServer");
      const entry = found.find((e) => e.messageId === "webImportsServer");
      expect(entry.message).toBe(
        "A web package cannot import a server package." +
          " Call the API the server exposes, or import the type from the contract.",
      );
    });
  });

  describe("when a server package imports a different feature's web package", () => {
    /** @scenario "A server package importing another feature's web package is reported as serverImportsBrowser" */
    it("reports serverImportsBrowser with the specifier", () => {
      const found = report(
        "modules/agent/server/src/services/agent.service.ts",
        'import { ProjectCard } from "@langwatch/project-web";',
      );

      const entry = found.find((e) => e.messageId === "serverImportsBrowser");
      expect(entry).toBeTruthy();
      expect(entry.data.specifier).toBe("@langwatch/project-web");
    });
  });

  describe("when a contract package imports a node runtime module", () => {
    /** @scenario "A contract package importing a runtime is reported as contractRuntime" */
    it("reports contractRuntime with the specifier", () => {
      const found = report(
        "modules/agent/contract/src/agent.commands.ts",
        'import { readFileSync } from "node:fs";',
      );

      const entry = found.find((e) => e.messageId === "contractRuntime");
      expect(entry).toBeTruthy();
      expect(entry.data.specifier).toBe("node:fs");
      expect(entry.message).toBe(
        "A contract package is transport-neutral: `node:fs` is a node/browser/server runtime." +
          " Move this code to the server or web package and keep only types and schemas here.",
      );
    });
  });

  describe("when an import names a deleted alias", () => {
    /** @scenario "A deleted alias import is reported as deadAlias" */
    it("reports deadAlias with the specifier", () => {
      const found = report(
        "modules/agent/server/src/services/agent.service.ts",
        'import { helper } from "~/lib/helper";',
      );

      const entry = found.find((e) => e.messageId === "deadAlias");
      expect(entry).toBeTruthy();
      expect(entry.data.specifier).toBe("~/lib/helper");
    });
  });

  describe("when a core feature imports an enterprise package", () => {
    /** @scenario "Core code importing an enterprise package is reported as coreImportsEnterprise" */
    it("reports coreImportsEnterprise", () => {
      const enterprise = createFixtureWorkspace({});
      // Build a second workspace by hand: an enterprise feature package the
      // core `agent` feature then imports from.
      enterprise.write(
        "modules/agent/server/package.json",
        JSON.stringify({ name: "@langwatch/agent-server", exports: { ".": "." } }),
      );
      enterprise.write("modules/agent/server/src/services/agent.service.ts", "export {}");
      enterprise.write(
        "enterprise/modules/governance/server/package.json",
        JSON.stringify({ name: "@langwatch/enterprise-governance-server", exports: { ".": "." } }),
      );
      try {
        const found = runRule(boundaryRule, {
          code: 'import { GovernanceService } from "@langwatch/enterprise-governance-server";',
          cwd: enterprise.cwd,
          filename: "modules/agent/server/src/services/agent.service.ts",
        });

        expect(found.map((e) => e.messageId)).toContain("coreImportsEnterprise");
      } finally {
        enterprise.cleanup();
      }
    });
  });

  describe("when a package's export subpath is not declared", () => {
    /** @scenario "An undeclared export subpath is reported as sealedExports" */
    it("reports sealedExports naming the subpath and package", () => {
      const found = report(
        "modules/agent/server/src/services/agent.service.ts",
        'import { helper } from "@langwatch/project-contract/internal";',
      );

      const entry = found.find((e) => e.messageId === "sealedExports");
      expect(entry).toBeTruthy();
      expect(entry.data).toEqual({ subpath: "./internal", package: "@langwatch/project-contract" });
    });
  });

  describe("when a server package imports the same feature's contract package correctly", () => {
    /** @scenario "A well-formed cross-package import within a feature is left alone" */
    it("reports nothing", () => {
      expect(
        report(
          "modules/agent/server/src/services/agent.service.ts",
          'import { AgentCommand } from "@langwatch/agent-contract";',
        ),
      ).toEqual([]);
    });
  });
});
