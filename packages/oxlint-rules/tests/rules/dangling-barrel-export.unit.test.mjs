import { afterAll, describe, expect, it } from "vitest";
import { danglingBarrelExportRule, resetDanglingResolutionCache } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {}, web: {} } } },
  files: {
    "modules/agent/server/src/index.ts": "export const barrel = 1;\n",
    "modules/agent/server/src/services/agent.service.ts": "export const agent = 1;\n",
    "modules/agent/web/src/agent.styles.css": ".agent {}\n",
  },
});

afterAll(() => workspace.cleanup());

const BARREL = "modules/agent/server/src/index.ts";
const SERVICE = "modules/agent/server/src/services/agent.service.ts";

function report(code, filename = BARREL) {
  resetDanglingResolutionCache();

  return runRule(danglingBarrelExportRule, { code, cwd: workspace.cwd, filename });
}

describe("given a barrel file", () => {
  describe("when it re-exports a path that no file answers to", () => {
    /** @scenario "A re-export of a moved file is dangling" */
    it("reports danglingReexport", () => {
      const found = report("export { agent } from './repositories/agent.repository';");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("danglingReexport");
      expect(found[0].data.specifier).toBe("./repositories/agent.repository");
    });
  });

  describe("when it star-exports a path that no file answers to", () => {
    /** @scenario "A star re-export of a deleted folder is dangling" */
    it("reports danglingReexport", () => {
      const found = report("export * from './channels';");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("danglingReexport");
    });
  });

  describe("when it re-exports a file that exists", () => {
    /** @scenario "A re-export that resolves on disk is allowed" */
    it("reports nothing", () => {
      expect(report("export { agent } from './services/agent.service';")).toEqual([]);
    });
  });

  describe("when it re-exports a folder holding an index file", () => {
    /** @scenario "A re-export of a folder with an index file is allowed" */
    it("reports nothing", () => {
      expect(report("export * from '..';", SERVICE)).toEqual([]);
    });
  });
});

describe("given a source file", () => {
  describe("when it imports a path that no file answers to", () => {
    /** @scenario "An import of a moved file is dangling" */
    it("reports danglingImport", () => {
      const found = report("import { agent } from '../repositories/agent.repository';", SERVICE);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("danglingImport");
    });
  });

  describe("when it imports the compiled name of a TypeScript file", () => {
    /** @scenario "An import written with a .js extension resolves to the .ts file" */
    it("reports nothing", () => {
      expect(report("import { agent } from './services/agent.service.js';")).toEqual([]);
    });
  });

  describe("when it imports an asset by its exact path", () => {
    /** @scenario "An import of a non-source file that exists is allowed" */
    it("reports nothing", () => {
      expect(report("import './agent.styles.css';", "modules/agent/web/src/index.ts")).toEqual([]);
    });
  });

  describe("when it imports a package specifier", () => {
    /** @scenario "A package specifier is never resolved against the disk" */
    it("reports nothing", () => {
      expect(
        report("import { z } from 'zod';\nexport * from '@langwatch/agent-contract';"),
      ).toEqual([]);
    });
  });

  describe("when it imports through a build-tool suffix", () => {
    /** @scenario "A specifier carrying a build-tool suffix is not resolved" */
    it("reports nothing", () => {
      expect(report("import worker from './agent.worker?worker';")).toEqual([]);
    });
  });
});
