import { afterAll, describe, expect, it } from "vitest";
import { boundaryRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: {
    agent: { roles: { contract: {}, process: {}, browser: {} } },
    project: { roles: { contract: {}, process: {}, browser: {} } },
  },
});

afterAll(() => workspace.cleanup());

function report(filename, code) {
  return runRule(boundaryRule, { code, cwd: workspace.cwd, filename });
}

describe("given package-boundaries", () => {
  it("allows a cross-feature web dependency through the surfaces/<id> door", () => {
    const fixture = createFixtureWorkspace({
      features: {
        annotation: { roles: { browser: {} } },
        organization: {
          roles: { browser: { exports: ["./surfaces/personal-workspace-features"] } },
        },
      },
    });

    try {
      expect(
        runRule(boundaryRule, {
          cwd: fixture.cwd,
          filename: "modules/annotation/browser/src/behavior/gate.ts",
          code: 'import { client } from "@langwatch/organization-browser/surfaces/personal-workspace-features";',
        }),
      ).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a cross-feature web dependency outside the surfaces/<id> door", () => {
    const fixture = createFixtureWorkspace({
      features: {
        annotation: { roles: { browser: {} } },
        organization: {
          roles: { browser: { exports: ["./personal-workspace-features"] } },
        },
      },
    });

    try {
      expect(
        runRule(boundaryRule, {
          cwd: fixture.cwd,
          filename: "modules/annotation/browser/src/behavior/gate.ts",
          code: 'import { client } from "@langwatch/organization-browser/personal-workspace-features";',
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
        "modules/agent/browser/src/behavior/agent-api.ts",
        'import { ProjectService } from "@langwatch/project-process";',
      );

      expect(found.map((e) => e.messageId)).toContain("webImportsServer");
      const entry = found.find((e) => e.messageId === "webImportsServer");
      expect(entry.message).toBe(
        "`@langwatch/project-process` is server-only, and this is a web package." +
          " Call the REST or tRPC endpoint the server exposes through this feature's" +
          " web client, and import any shared type from `@langwatch/<feature>-contract`.",
      );
    });
  });

  describe("when a server package imports a different feature's web package", () => {
    /** @scenario "A server package importing another feature's web package is reported as serverImportsBrowser" */
    it("reports serverImportsBrowser with the specifier", () => {
      const found = report(
        "modules/agent/process/src/services/agent.service.ts",
        'import { ProjectCard } from "@langwatch/project-browser";',
      );

      const entry = found.find((e) => e.messageId === "serverImportsBrowser");
      expect(entry).toBeTruthy();
      expect(entry.data.specifier).toBe("@langwatch/project-browser");
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
        "A contract package is transport-neutral: `node:fs` is a node, browser or server runtime." +
          " Keep only types and schemas here, and move the code that calls `node:fs` to the" +
          " feature's server package when it is a `node:` or server import, or to its web" +
          " package when it is a browser import.",
      );
    });
  });

  describe("when an import names a deleted alias", () => {
    /** @scenario "A deleted alias import is reported as deadAlias" */
    it("reports deadAlias with the specifier", () => {
      const found = report(
        "modules/agent/process/src/services/agent.service.ts",
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
        "modules/agent/process/package.json",
        JSON.stringify({ name: "@langwatch/agent-process", exports: { ".": "." } }),
      );
      enterprise.write("modules/agent/process/src/services/agent.service.ts", "export {}");
      enterprise.write(
        "enterprise/modules/governance/process/package.json",
        JSON.stringify({ name: "@langwatch/enterprise-governance-process", exports: { ".": "." } }),
      );
      try {
        const found = runRule(boundaryRule, {
          code: 'import { GovernanceService } from "@langwatch/enterprise-governance-process";',
          cwd: enterprise.cwd,
          filename: "modules/agent/process/src/services/agent.service.ts",
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
        "modules/agent/process/src/services/agent.service.ts",
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
          "modules/agent/process/src/services/agent.service.ts",
          'import { AgentCommand } from "@langwatch/agent-contract";',
        ),
      ).toEqual([]);
    });
  });
});
