import { afterAll, describe, expect, it } from "vitest";

import { boundaryRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: {
    agent: {
      roles: {
        contract: {},
        process: {},
        browser: { exports: ["./declaration"] },
        "browser-kit": {},
      },
    },
    project: {
      roles: {
        contract: {},
        process: { exports: [".", "./testing"] },
        browser: { exports: ["./declaration", "./surfaces/project-picker"] },
        "browser-kit": {},
      },
    },
  },
  files: {
    "enterprise/modules/governance/process/package.json": JSON.stringify({
      name: "@langwatch/enterprise-governance-process",
      exports: { ".": "." },
    }),
    "enterprise/modules/governance/contract/package.json": JSON.stringify({
      name: "@langwatch/enterprise-governance-contract",
      exports: { ".": "." },
    }),
  },
});

afterAll(() => workspace.cleanup());

function report(filename, code) {
  return runRule(boundaryRule, { code, cwd: workspace.cwd, filename });
}

function ids(filename, code) {
  return report(filename, code).map((entry) => entry.messageId);
}

const SERVICE = "modules/agent/process/src/services/agent.service.ts";
const SERVICE_TEST = "modules/agent/process/src/services/__tests__/agent.integration.test.ts";
const BROWSER = "modules/agent/browser/src/behavior/agent-list.ts";
const KIT = "modules/agent/browser-kit/src/agent-card.tsx";

describe("given package-boundaries", () => {
  describe("when a browser package imports another module's browser package", () => {
    /** @scenario "A browser package importing another module's browser package is reported as crossModuleBrowser" */
    it("reports crossModuleBrowser at the specifier and names the owner's kit", () => {
      const found = report(
        BROWSER,
        'import { z } from "zod";\nimport { Picker } from "@langwatch/project-browser/surfaces/project-picker";',
      );

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ line: 2, messageId: "crossModuleBrowser" });
      expect(found[0].message).toBe(
        "`@langwatch/project-browser/surfaces/project-picker` is `project`'s browser package, which is closed to every other module." +
          " Move what this needs into `@langwatch/project-browser-kit` and import it from there; where fewer than" +
          " two modules share it, inline it here instead (the kit law, ARCHITECTURE.md §3.4).",
      );
    });

    /** @scenario "A browser package importing another module's kit is left alone" */
    it("leaves an import of the owner's kit alone", () => {
      expect(report(BROWSER, 'import { Card } from "@langwatch/project-browser-kit";')).toEqual([]);
    });
  });

  describe("when a browser kit imports a browser package", () => {
    /** @scenario "A browser kit importing a browser package or another kit is reported as kitLeaf" */
    it("reports kitLeaf for its own module's browser package and for another kit", () => {
      expect(ids(KIT, 'import { x } from "@langwatch/agent-browser/declaration";')).toEqual([
        "kitLeaf",
      ]);
      expect(ids(KIT, 'import { Card } from "@langwatch/project-browser-kit";')).toEqual([
        "kitLeaf",
      ]);
    });

    /** @scenario "A browser kit importing a browser package or another kit is reported as kitLeaf" */
    it("leaves contracts, the design system and the host alone", () => {
      const code = [
        'import type { Agent } from "@langwatch/project-contract";',
        'import { Button } from "@langwatch/design-system";',
        'import { useSession } from "@langwatch/browser-host";',
      ].join("\n");

      expect(report(KIT, code)).toEqual([]);
    });

    /** @scenario "A browser kit that fetches is reported as kitFetches" */
    it("reports kitFetches for the tRPC client", () => {
      expect(ids(KIT, 'import { client } from "@langwatch/browser-trpc";')).toEqual(["kitFetches"]);
    });
  });

  describe("when a process package imports another module's process package", () => {
    /** @scenario "A process package importing another module's process package is reported as crossModuleProcess" */
    it("reports crossModuleProcess naming the owner's Api and contract", () => {
      const found = report(SERVICE, 'import { ProjectService } from "@langwatch/project-process";');

      expect(found.map((entry) => entry.messageId)).toEqual(["crossModuleProcess"]);
      expect(found[0].data).toMatchObject({
        api: "ProjectApi",
        contract: "@langwatch/project-contract",
      });
    });

    /** @scenario "A test installs a peer module or reads its test seam" */
    it("leaves a test's peer installer and the declared ./testing seam alone", () => {
      expect(
        report(SERVICE_TEST, 'import { projectServer } from "@langwatch/project-process";'),
      ).toEqual([]);
      expect(
        report(SERVICE_TEST, 'import { fixture } from "@langwatch/project-process/testing";'),
      ).toEqual([]);
    });

    /** @scenario "A test installs a peer module or reads its test seam" */
    it("still reports a test that takes a peer's service", () => {
      expect(
        ids(SERVICE_TEST, 'import { ProjectService } from "@langwatch/project-process";'),
      ).toEqual(["crossModuleProcess"]);
    });

    /** @scenario "A test installs a peer module or reads its test seam" */
    it("still reports production code that reads a peer's ./testing seam", () => {
      expect(ids(SERVICE, 'import { fixture } from "@langwatch/project-process/testing";')).toEqual(
        ["crossModuleProcess"],
      );
    });
  });

  describe("when a module's own test imports its own process package", () => {
    /** @scenario "A module's own tests import its own process package" */
    it("reports nothing", () => {
      expect(
        report(SERVICE_TEST, 'import { AgentService } from "@langwatch/agent-process";'),
      ).toEqual([]);
    });
  });

  describe("when a browser package imports a process package", () => {
    /** @scenario "A browser package importing a process package is reported as browserImportsProcess" */
    it("reports browserImportsProcess", () => {
      const found = report(BROWSER, 'import { ProjectService } from "@langwatch/project-process";');

      expect(found.map((entry) => entry.messageId)).toEqual(["browserImportsProcess"]);
      expect(found[0].message).toBe(
        "`@langwatch/project-process` is process-only, and this is a browser package." +
          " Call the procedure through this module's derived tRPC client, and import any shared type" +
          " from the owning module's contract.",
      );
    });
  });

  describe("when a process package imports a browser package", () => {
    /** @scenario "A process package importing a browser package is reported as processImportsBrowser" */
    it("reports processImportsBrowser with the specifier", () => {
      const found = report(SERVICE, 'import { Card } from "@langwatch/project-browser-kit";');

      expect(found.map((entry) => entry.messageId)).toEqual(["processImportsBrowser"]);
      expect(found[0].data.specifier).toBe("@langwatch/project-browser-kit");
    });
  });

  describe("when a contract package imports a node runtime module", () => {
    /** @scenario "A contract package importing a runtime is reported as contractRuntime" */
    it("reports contractRuntime with the specifier", () => {
      const found = report(
        "modules/agent/contract/src/agent.commands.ts",
        'import { readFileSync } from "node:fs";',
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["contractRuntime"]);
      expect(found[0].message).toBe(
        "A contract package is runtime-neutral: `node:fs` is a node, browser or process runtime." +
          " Keep only schemas, types, errors and the `*Api` token here; move the code that needs" +
          " `node:fs` into this module's process package, or into its browser package when it is a browser import.",
      );
    });
  });

  describe("when a core module imports an enterprise module's process package", () => {
    /** @scenario "Core code importing an enterprise implementation is reported as coreImportsEnterprise" */
    it("reports coreImportsEnterprise", () => {
      expect(
        ids(
          SERVICE,
          'import { governanceServer } from "@langwatch/enterprise-governance-process";',
        ),
      ).toContain("coreImportsEnterprise");
    });
  });

  describe("when a core module names an enterprise module's peer Api from its contract", () => {
    /** @scenario "Core code may depend on an enterprise module's contract" */
    it("reports nothing about the enterprise tier", () => {
      expect(
        ids(SERVICE, 'import { GovernanceApi } from "@langwatch/enterprise-governance-contract";'),
      ).not.toContain("coreImportsEnterprise");
    });
  });

  describe("when a package's export subpath is not declared", () => {
    /** @scenario "An undeclared export subpath is reported as sealedExports" */
    it("reports sealedExports naming the subpath and package", () => {
      const found = report(
        SERVICE,
        'import { helper } from "@langwatch/project-contract/internal";',
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["sealedExports"]);
      expect(found[0].data).toEqual({
        subpath: "./internal",
        package: "@langwatch/project-contract",
      });
    });
  });

  describe("when code outside every module imports a process package", () => {
    /** @scenario "A composition root naming a process package is told to compose through the module" */
    it("reports compositionRoot in an application's main and in the rest of the application", () => {
      const found = report(
        "apps/api/src/main.ts",
        'import { createAgentReader } from "@langwatch/agent-process";',
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["compositionRoot"]);
      expect(found[0].message).toContain("`@langwatch/installed-server-modules`");
      expect(
        ids("apps/tasks/src/lwql-provision.ts", 'import { Task } from "@langwatch/agent-process";'),
      ).toEqual(["compositionRoot"]);
    });

    /** @scenario "Code outside a module importing its process package is reported as processOutsideModule" */
    it("reports processOutsideModule anywhere else", () => {
      expect(
        ids(
          "packages/storage-seed/src/seed.ts",
          'import { AgentService } from "@langwatch/agent-process";',
        ),
      ).toEqual(["processOutsideModule"]);
    });
  });

  describe("when code outside every module imports a browser package", () => {
    /** @scenario "Code outside a module reaching past a browser declaration is reported as browserSideDoor" */
    it("reports browserSideDoor past the declaration and leaves the declaration alone", () => {
      const shell = "apps/ui/src/shell/navigation.tsx";

      expect(
        ids(shell, 'import { P } from "@langwatch/project-browser/surfaces/project-picker";'),
      ).toEqual(["browserSideDoor"]);
      expect(report(shell, 'import { d } from "@langwatch/project-browser/declaration";')).toEqual(
        [],
      );
    });
  });

  describe("when a relative import walks into another module's process package", () => {
    /** @scenario "A relative import into another package is reported as packageEscape" */
    it("reports packageEscape", () => {
      expect(
        ids(
          SERVICE,
          'import { ProjectService } from "../../../../project/process/src/project.service.ts";',
        ),
      ).toEqual(["packageEscape"]);
    });
  });

  describe("when a process package imports its own module's contract", () => {
    /** @scenario "A well-formed cross-package import within a module is left alone" */
    it("reports nothing", () => {
      expect(report(SERVICE, 'import { AgentCommand } from "@langwatch/agent-contract";')).toEqual(
        [],
      );
    });
  });
});
