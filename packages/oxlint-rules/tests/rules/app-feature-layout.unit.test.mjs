import { afterAll, describe, expect, it } from "vitest";

import { appFeatureLayoutRule } from "../../src/rules/app-feature-layout.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

function manifest(features) {
  return JSON.stringify({ langwatch: { features, layout: "app-features" }, name: "site" });
}

const workspace = createFixtureWorkspace({
  files: {
    "apps/site/package.json": manifest({
      code: [],
      navigation: ["code"],
      shell: ["navigation"],
    }),
    "apps/loop/package.json": manifest({ a: ["b"], b: ["a"] }),
    "apps/plain/package.json": JSON.stringify({ name: "plain" }),
  },
});

afterAll(() => workspace.cleanup());

const SRC = "apps/site/src";

function report(filename, code) {
  return runRule(appFeatureLayoutRule, { code, cwd: workspace.cwd, filename }).map(
    ({ line, messageId }) => ({ line, messageId }),
  );
}

describe("given an application that does not opt in", () => {
  describe("when a file reaches into anything", () => {
    /** @scenario "Only an application that opts in is governed" */
    it("reports nothing", () => {
      const code = 'import { x } from "../features/code/ui/x.tsx";';

      expect(report("apps/plain/src/app/main.ts", code)).toEqual([]);
    });
  });
});

describe("given a feature layer", () => {
  describe("when the model imports a component or build-time code", () => {
    /** @scenario "Each layer takes only what its row allows" */
    it("reports layerCrossing for the ui and compile imports", () => {
      const code = [
        'import type { Row } from "../ui/row.tsx";',
        'import { readNav } from "../compile/nav.ts";',
        'import { sibling } from "./sibling.ts";',
        'import { slug } from "../../../lib/slug.ts";',
      ].join("\n");

      expect(report(`${SRC}/features/navigation/model/nav.ts`, code)).toEqual([
        { line: 1, messageId: "layerCrossing" },
        { line: 2, messageId: "layerCrossing" },
      ]);
    });
  });

  describe("when build-time code or a browser island imports a component", () => {
    /** @scenario "Each layer takes only what its row allows" */
    it("reports layerCrossing, and passes the model", () => {
      const compile = [
        'import { Card } from "../ui/card.tsx";',
        'import { nav } from "../model/nav.ts";',
      ].join("\n");
      const browser = [
        'import { Card } from "../ui/card.tsx";',
        'import { nav } from "../model/nav.ts";',
        'import "../ui/nav.css";',
      ].join("\n");

      expect(report(`${SRC}/features/navigation/compile/build.ts`, compile)).toEqual([
        { line: 1, messageId: "layerCrossing" },
      ]);
      expect(report(`${SRC}/features/navigation/browser/menus.ts`, browser)).toEqual([
        { line: 1, messageId: "layerCrossing" },
      ]);
    });
  });
});

describe("given an import of another feature", () => {
  describe("when it names a file inside that feature", () => {
    /** @scenario "Another feature is reached only through its layer entry" */
    it("reports internalReach", () => {
      const code = 'import { CodeBlock } from "../../code/ui/code-block.tsx";';

      expect(report(`${SRC}/features/navigation/ui/tree.tsx`, code)).toEqual([
        { line: 1, messageId: "internalReach" },
      ]);
    });
  });

  describe("when it names a declared dependency's entry its layer may take", () => {
    /** @scenario "Another feature is reached only through its layer entry" */
    it("reports nothing", () => {
      const code = [
        'import { CodeBlock } from "../../code/ui.ts";',
        'import { languageName } from "../../code/model.ts";',
      ].join("\n");

      expect(report(`${SRC}/features/navigation/ui/tree.tsx`, code)).toEqual([]);
    });
  });

  describe("when the entry is of a layer the importer may not take", () => {
    /** @scenario "Each layer takes only what its row allows" */
    it("reports layerCrossing", () => {
      const code = 'import { CodeBlock } from "../../code/ui.ts";';

      expect(report(`${SRC}/features/navigation/compile/build.ts`, code)).toEqual([
        { line: 1, messageId: "layerCrossing" },
      ]);
    });
  });

  describe("when the feature is not a declared dependency", () => {
    /** @scenario "A feature imports only the features it declares" */
    it("reports undeclaredDependency", () => {
      const code = 'import { Shell } from "../../shell/ui.ts";';

      expect(report(`${SRC}/features/navigation/ui/tree.tsx`, code)).toEqual([
        { line: 1, messageId: "undeclaredDependency" },
      ]);
    });
  });

  describe("when a feature imports its own entry", () => {
    /** @scenario "A feature imports its own files directly" */
    it("reports ownEntry", () => {
      const code = 'import { Tree } from "../ui.ts";';

      expect(report(`${SRC}/features/navigation/ui/side.tsx`, code)).toEqual([
        { line: 1, messageId: "ownEntry" },
      ]);
    });
  });
});

describe("given the composition", () => {
  describe("when it imports a feature", () => {
    /** @scenario "The composition reaches features through their entries" */
    it("reports internalReach for a file and passes an entry of any layer", () => {
      const code = [
        'import { Shell } from "../features/shell/ui/shell.tsx";',
        'import { Shell as Entry } from "../features/shell/ui.ts";',
        'import { buildNav } from "../features/navigation/compile.ts";',
        'import "../features/navigation/ui/nav.css";',
      ].join("\n");

      expect(report(`${SRC}/site/prerender.ts`, code)).toEqual([
        { line: 1, messageId: "internalReach" },
      ]);
    });
  });

  describe("when a feature imports the composition", () => {
    /** @scenario "The composition reaches features through their entries" */
    it("reports reachesComposition", () => {
      const code = 'import { render } from "../../../site/prerender.ts";';

      expect(report(`${SRC}/features/shell/compile/page.ts`, code)).toEqual([
        { line: 1, messageId: "reachesComposition" },
      ]);
    });
  });
});

describe("given a shared leaf", () => {
  /** @scenario "Shared leaves import only each other" */
  it("reports leafReachesUp for a feature or the composition, and passes a leaf", () => {
    const code = [
      'import { site } from "../features/navigation/model.ts";',
      'import { render } from "../site/prerender.ts";',
      'import { basePath } from "../config.ts";',
      'import { storage } from "./storage.ts";',
    ].join("\n");

    expect(report(`${SRC}/lib/site-path.ts`, code)).toEqual([
      { line: 1, messageId: "leafReachesUp" },
      { line: 2, messageId: "leafReachesUp" },
    ]);
  });
});

describe("given a feature entry", () => {
  describe("when it re-exports its own layer by name", () => {
    /** @scenario "A feature entry only re-exports its own layer" */
    it("reports nothing", () => {
      const code = [
        'export { CodeBlock } from "./ui/code-block.tsx";',
        'export type { CodeSource } from "./ui/code-parts.tsx";',
      ].join("\n");

      expect(report(`${SRC}/features/code/ui.ts`, code)).toEqual([]);
    });
  });

  describe("when it holds code, an import or another layer", () => {
    /** @scenario "A feature entry only re-exports its own layer" */
    it("reports entryShape on each statement", () => {
      const code = [
        'import { x } from "./ui/x.tsx";',
        'export { languageName } from "./model/languages.ts";',
        'export * from "./ui/code-block.tsx";',
        "export const y = 1;",
      ].join("\n");

      expect(report(`${SRC}/features/code/ui.ts`, code)).toEqual([
        { line: 1, messageId: "entryShape" },
        { line: 2, messageId: "entryShape" },
        { line: 3, messageId: "entryShape" },
        { line: 4, messageId: "entryShape" },
      ]);
    });
  });
});

describe("given a file outside the layout", () => {
  /** @scenario "Every file sits in a known place" */
  it("reports unknownPlace for an unknown folder and a file beside the layers", () => {
    expect(report(`${SRC}/helpers/x.ts`, "export const x = 1;")).toEqual([
      { line: 1, messageId: "unknownPlace" },
    ]);
    expect(report(`${SRC}/features/code/helpers.ts`, "export const x = 1;")).toEqual([
      { line: 1, messageId: "unknownPlace" },
    ]);
  });
});

describe("given the declared feature graph", () => {
  describe("when a feature folder is not declared", () => {
    /** @scenario "Every feature is declared and the graph is acyclic" */
    it("reports undeclaredFeature", () => {
      expect(report(`${SRC}/features/search/model/index.ts`, "export const x = 1;")).toEqual([
        { line: 1, messageId: "undeclaredFeature" },
      ]);
    });
  });

  describe("when two features declare each other", () => {
    /** @scenario "Every feature is declared and the graph is acyclic" */
    it("reports dependencyCycle in both", () => {
      const found = runRule(appFeatureLayoutRule, {
        code: "export const x = 1;",
        cwd: workspace.cwd,
        filename: "apps/loop/src/features/a/model/a.ts",
      });

      expect(found.map(({ messageId }) => messageId)).toEqual(["dependencyCycle"]);
      expect(found[0].message).toContain("a -> b -> a");
      expect(report("apps/loop/src/features/b/model/b.ts", "export const x = 1;")).toEqual([
        { line: 1, messageId: "dependencyCycle" },
      ]);
    });
  });
});

describe("given a test file", () => {
  /** @scenario "Only an application that opts in is governed" */
  it("reports nothing", () => {
    const code = 'import { x } from "../../../code/ui/x.tsx";';

    expect(report(`${SRC}/features/navigation/ui/__tests__/tree.unit.test.tsx`, code)).toEqual([]);
  });
});
