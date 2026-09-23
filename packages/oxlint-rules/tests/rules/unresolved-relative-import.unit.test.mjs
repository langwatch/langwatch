import { afterAll, describe, expect, it } from "vitest";

import {
  resetUnresolvedImportCache,
  unresolvedRelativeImportRule,
} from "../../src/rules/unresolved-relative-import.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { roles: { process: {}, browser: {} } } },
  files: {
    "modules/agent/process/src/index.ts": "export const barrel = 1;\n",
    "modules/agent/process/src/services/agent.service.ts": "export const agent = 1;\n",
    "modules/agent/browser/src/agent.styles.css": ".agent {}\n",
  },
});

afterAll(() => workspace.cleanup());

const BARREL = "modules/agent/process/src/index.ts";
const SERVICE = "modules/agent/process/src/services/agent.service.ts";

function report(code, filename = BARREL) {
  resetUnresolvedImportCache();

  return runRule(unresolvedRelativeImportRule, { code, cwd: workspace.cwd, filename });
}

function located(found) {
  return found.map((finding) => [finding.messageId, finding.data.specifier, finding.line]);
}

describe("given a file with relative specifiers", () => {
  describe("when a re-export names a path no file answers to", () => {
    /** @scenario "A re-export of a moved file is unresolved" */
    it("reports unresolved on the re-export's line", () => {
      const found = report(
        "export const x = 1;\nexport { agent } from './repositories/agent.repository';\nexport * from './channels';",
      );

      expect(located(found)).toEqual([
        ["unresolved", "./repositories/agent.repository", 2],
        ["unresolved", "./channels", 3],
      ]);
    });
  });

  describe("when a static import names a path no file answers to", () => {
    /** @scenario "A static import of a moved file is unresolved" */
    it("reports unresolved", () => {
      const found = report("import { agent } from '../repositories/agent.repository';", SERVICE);

      expect(located(found)).toEqual([["unresolved", "../repositories/agent.repository", 1]]);
    });
  });

  describe("when a dynamic import names a path no file answers to", () => {
    /** @scenario "A dynamic import of a moved file is unresolved" */
    it("reports unresolved on the import expression's line", () => {
      const found = report(
        "export async function load() {\n  return import('../channels/agent.channel');\n}",
        SERVICE,
      );

      expect(located(found)).toEqual([["unresolved", "../channels/agent.channel", 2]]);
    });
  });

  describe("when a require call names a path no file answers to", () => {
    /** @scenario "A require of a moved file is unresolved" */
    it("reports unresolved", () => {
      const found = report(
        "const gone = require(`./gone`);\nconst kept = require('../index');",
        SERVICE,
      );

      expect(located(found)).toEqual([["unresolved", "./gone", 1]]);
    });
  });

  describe("when every specifier resolves on disk", () => {
    /** @scenario "A specifier that resolves on disk is allowed" */
    it.each([
      [
        "a re-export of a file that exists",
        "export { agent } from './services/agent.service';",
        BARREL,
      ],
      ["a folder holding an index file", "export * from '..';", SERVICE],
      [
        "the compiled name of a TypeScript file",
        "import { agent } from './services/agent.service.js';",
        BARREL,
      ],
      [
        "an asset by its exact path",
        "import './agent.styles.css';",
        "modules/agent/browser/src/index.ts",
      ],
      [
        "a dynamic import of a file that exists",
        "export const load = () => import('./agent.service');",
        SERVICE,
      ],
    ])("reports nothing for %s", (_label, code, filename) => {
      expect(report(code, filename)).toEqual([]);
    });
  });

  describe("when the specifier is not a relative file path", () => {
    /** @scenario "A package specifier, a computed specifier or a build-tool suffix is not resolved" */
    it.each([
      "import { z } from 'zod';\nexport * from '@langwatch/agent-contract';",
      "import worker from './agent.worker?worker';",
      "export const load = (name) => import(`./${name}`);",
      "const module = require(name);",
    ])("reports nothing for %s", (code) => {
      expect(report(code)).toEqual([]);
    });
  });
});
