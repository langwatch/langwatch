import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  chooseSubject,
  planTestColocation,
  rewriteRelativeSpecifiers,
} from "../src/test-colocation";

let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function write(path: string, contents: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

/** A strict feature package the workspace scanner will discover. */
function featurePackage(feature: string, role: "contract" | "server" | "web"): void {
  write("pnpm-workspace.yaml", 'packages:\n  - "packages/features/*/*"\n');
  write(`packages/features/${feature}/feature.json`, JSON.stringify({ layoutVersion: 0 }));
  write(
    "packages/features/catalogue.json",
    JSON.stringify({
      version: 0,
      features: [
        {
          id: feature,
          root: `packages/features/${feature}`,
          classification: "core",
          subjects: [feature],
        },
      ],
    }),
  );
  write(
    `packages/features/${feature}/${role}/package.json`,
    JSON.stringify({ name: `@langwatch/${feature}-${role}`, version: "0.0.1" }),
  );
}

function relativeMoves(): Array<[string, string]> {
  return planTestColocation(root).moves.map(({ from, to }) => [
    from.slice(root.length + 1),
    to.slice(root.length + 1),
  ]);
}

describe("chooseSubject", () => {
  describe("given a test that imports one module", () => {
    it("takes it, whatever the mirror path said", () => {
      expect(
        chooseSubject("/p/tests/anything.unit.test.ts", "anything.unit.test.ts", [
          "/p/src/services/agent.service.ts",
        ]),
      ).toBe("/p/src/services/agent.service.ts");
    });
  });

  describe("given a test that imports several", () => {
    /**
     * The test's own name is the strongest statement anyone makes about what
     * it covers, so it outranks both the mirror and the import counts.
     */
    it("prefers the import whose subject matches the test's name", () => {
      expect(
        chooseSubject("/p/tests/prompt.service.unit.test.ts", "prompt.service.unit.test.ts", [
          "/p/src/adapters/a.adapter.ts",
          "/p/src/adapters/b.adapter.ts",
          "/p/src/services/prompt.service.ts",
        ]),
      ).toBe("/p/src/services/prompt.service.ts");
    });

    it("falls back to the directory the old mirror path named", () => {
      expect(
        chooseSubject(
          "/p/tests/services/lifecycle.unit.test.ts",
          "services/lifecycle.unit.test.ts",
          [
            "/p/src/adapters/a.adapter.ts",
            "/p/src/adapters/b.adapter.ts",
            "/p/src/services/agent.service.ts",
          ],
        ),
      ).toBe("/p/src/services/agent.service.ts");
    });

    it("falls back to the directory it imports from most", () => {
      expect(
        chooseSubject("/p/tests/lifecycle.unit.test.ts", "lifecycle.unit.test.ts", [
          "/p/src/adapters/a.adapter.ts",
          "/p/src/adapters/b.adapter.ts",
          "/p/src/services/agent.service.ts",
        ]),
      ).toBe("/p/src/adapters/a.adapter.ts");
    });

    it("resolves a remaining tie by path order, so the plan is deterministic", () => {
      const imports = ["/p/src/b/two.ts", "/p/src/a/one.ts"];
      expect(chooseSubject("/p/tests/x.unit.test.ts", "x.unit.test.ts", imports)).toBe(
        chooseSubject("/p/tests/x.unit.test.ts", "x.unit.test.ts", [...imports].reverse()),
      );
    });
  });

  describe("given a test that imports nothing under src", () => {
    it("answers undefined rather than guessing", () => {
      expect(chooseSubject("/p/tests/x.unit.test.ts", "x.unit.test.ts", [])).toBeUndefined();
    });
  });
});

/**
 * These run against a real temporary tree, not fictional paths: a specifier is
 * resolved by looking for the file it names, so `./thing` can mean `thing.ts`
 * or `thing/index.ts` and only the filesystem knows which. A lexical rewriter
 * would be faster and wrong.
 */
describe("rewriteRelativeSpecifiers", () => {
  function tree(files: Record<string, string>): void {
    root = mkdtempSync(join("/tmp", "langwatch-specifier-rewrite-"));
    for (const [path, contents] of Object.entries(files)) write(path, contents);
  }

  const rewrite = (from: string, to: string, source: string, moved = new Map<string, string>()) =>
    rewriteRelativeSpecifiers({
      from: join(root, from),
      to: join(root, to),
      source,
      moved: new Map([...moved].map(([a, b]) => [join(root, a), join(root, b)])),
    });

  it("re-expresses a specifier against the new directory", () => {
    tree({
      "src/services/agent.service.ts": "export class AgentService {}",
      "tests/agent.unit.test.ts": "",
    });

    expect(
      rewrite(
        "tests/agent.unit.test.ts",
        "src/services/__tests__/agent.unit.test.ts",
        'import { AgentService } from "../src/services/agent.service";\n',
      ),
    ).toBe('import { AgentService } from "../agent.service";\n');
  });

  it("keeps a specifier that was written extensionless extensionless", () => {
    tree({ "src/deep/nested/thing.ts": "export const x = 1;", "tests/a.unit.test.ts": "" });

    expect(
      rewrite(
        "tests/a.unit.test.ts",
        "src/__tests__/a.unit.test.ts",
        'import { x } from "../src/deep/nested/thing";\n',
      ),
    ).toBe('import { x } from "../deep/nested/thing";\n');
  });

  /**
   * In an ESM package the `.js` spelling is what actually resolves at runtime,
   * so rewriting it to `.ts` would break the import it was meant to preserve.
   */
  it("keeps a .js specifier spelled .js", () => {
    tree({ "src/services/agent.service.ts": "export const x = 1;", "tests/a.unit.test.ts": "" });

    expect(
      rewrite(
        "tests/a.unit.test.ts",
        "src/services/__tests__/a.unit.test.ts",
        'import { x } from "../src/services/agent.service.js";\n',
      ),
    ).toBe('import { x } from "../agent.service.js";\n');
  });

  it("resolves a directory import through its index", () => {
    tree({ "src/thing/index.ts": "export const x = 1;", "tests/a.unit.test.ts": "" });

    expect(
      rewrite(
        "tests/a.unit.test.ts",
        "src/other/__tests__/a.unit.test.ts",
        'import { x } from "../src/thing";\n',
      ),
    ).toBe('import { x } from "../../thing/index";\n');
  });

  it("follows a helper that is moving in the same plan", () => {
    tree({
      "src/services/agent.service.ts": "export const x = 1;",
      "tests/support/stub.ts": "export const stub = 1;",
      "tests/a.unit.test.ts": "",
    });

    expect(
      rewrite(
        "tests/a.unit.test.ts",
        "src/services/__tests__/a.unit.test.ts",
        'import { stub } from "./support/stub";\n',
        new Map([["tests/support/stub.ts", "src/services/__tests__/support/stub.ts"]]),
      ),
    ).toBe('import { stub } from "./support/stub";\n');
  });

  it("leaves a bare package specifier alone", () => {
    tree({ "tests/a.unit.test.ts": "" });
    const source = 'import { describe } from "vitest";\nimport { z } from "zod";\n';

    expect(rewrite("tests/a.unit.test.ts", "src/__tests__/a.unit.test.ts", source)).toBe(source);
  });

  it("rewrites a vi.mock path, which resolves like an import and breaks like one", () => {
    tree({ "src/services/agent.service.ts": "export const x = 1;", "tests/a.unit.test.ts": "" });

    expect(
      rewrite(
        "tests/a.unit.test.ts",
        "src/services/__tests__/a.unit.test.ts",
        'vi.mock("../src/services/agent.service", () => ({}));\n',
      ),
    ).toBe('vi.mock("../agent.service", () => ({}));\n');
  });
});

describe("planTestColocation", () => {
  describe("given a package whose tests mirror its source tree", () => {
    it("puts each test in a __tests__ beside the module it imports", () => {
      root = mkdtempSync(join("/tmp", "langwatch-test-colocation-"));
      featurePackage("agent", "server");
      write(
        "packages/features/agent/server/src/services/agent.service.ts",
        "export class AgentService {}",
      );
      write(
        "packages/features/agent/server/src/repositories/agent.repository.ts",
        "export abstract class AgentRepository {}",
      );
      write(
        "packages/features/agent/server/tests/services/agent.service.unit.test.ts",
        'import { AgentService } from "../../src/services/agent.service";\n',
      );
      write(
        "packages/features/agent/server/tests/agent.repository.unit.test.ts",
        'import { AgentRepository } from "../src/repositories/agent.repository";\n',
      );

      expect(relativeMoves()).toEqual([
        [
          "packages/features/agent/server/tests/agent.repository.unit.test.ts",
          "packages/features/agent/server/src/repositories/__tests__/agent.repository.unit.test.ts",
        ],
        [
          "packages/features/agent/server/tests/services/agent.service.unit.test.ts",
          "packages/features/agent/server/src/services/__tests__/agent.service.unit.test.ts",
        ],
      ]);
    });

    it("rewrites the moved test's own imports to reach its new neighbours", () => {
      root = mkdtempSync(join("/tmp", "langwatch-test-colocation-"));
      featurePackage("agent", "server");
      write(
        "packages/features/agent/server/src/services/agent.service.ts",
        "export class AgentService {}",
      );
      write(
        "packages/features/agent/server/tests/agent.service.unit.test.ts",
        'import { AgentService } from "../src/services/agent.service";\n',
      );

      const plan = planTestColocation(root);
      const [move] = plan.moves;

      expect(plan.edits.get(move!.from)).toBe('import { AgentService } from "../agent.service";\n');
    });
  });

  describe("given a test that reaches its subject through the package's own name", () => {
    /**
     * A sixth of the workspace's test files name their subject only this way.
     * Node resolves a self-reference through the package's `exports`, which for
     * these packages points back into `src`, so the subject is exactly as
     * knowable as it is for a relative import — treating it as unresolvable
     * would leave those tests in the mirror over a spelling.
     */
    it("resolves the subpath against src", () => {
      root = mkdtempSync(join("/tmp", "langwatch-test-colocation-"));
      featurePackage("agent", "server");
      write(
        "packages/features/agent/server/src/eventing/agent.events.ts",
        "export const AGENT_EVENTS = 1;",
      );
      write(
        "packages/features/agent/server/tests/agent.events.unit.test.ts",
        'import { AGENT_EVENTS } from "@langwatch/agent-server/eventing/agent.events";\n',
      );

      expect(relativeMoves()).toEqual([
        [
          "packages/features/agent/server/tests/agent.events.unit.test.ts",
          "packages/features/agent/server/src/eventing/__tests__/agent.events.unit.test.ts",
        ],
      ]);
    });

    it("resolves the bare package name to its index", () => {
      root = mkdtempSync(join("/tmp", "langwatch-test-colocation-"));
      featurePackage("agent", "server");
      write("packages/features/agent/server/src/index.ts", "export const x = 1;");
      write(
        "packages/features/agent/server/tests/barrel.unit.test.ts",
        'import { x } from "@langwatch/agent-server";\n',
      );

      expect(relativeMoves()).toEqual([
        [
          "packages/features/agent/server/tests/barrel.unit.test.ts",
          "packages/features/agent/server/src/__tests__/barrel.unit.test.ts",
        ],
      ]);
    });

    it("leaves another package's name alone", () => {
      root = mkdtempSync(join("/tmp", "langwatch-test-colocation-"));
      featurePackage("agent", "server");
      write("packages/features/agent/server/src/index.ts", "export const x = 1;");
      write(
        "packages/features/agent/server/tests/foreign.unit.test.ts",
        'import { y } from "@langwatch/other-server/index";\n',
      );

      const plan = planTestColocation(root);
      expect(plan.moves).toEqual([]);
      expect(plan.unresolved).toHaveLength(1);
    });
  });

  describe("given a fixture directory whose files share one name", () => {
    /**
     * Three fixture directories each holding an `index.ts` are three files.
     * Flattening them into one `__tests__` would silently make them one, so a
     * non-test file keeps its path under `tests/`.
     */
    it("keeps each one's directory rather than flattening them together", () => {
      root = mkdtempSync(join("/tmp", "langwatch-test-colocation-"));
      featurePackage("agent", "web");
      write("packages/features/agent/web/src/charts/chart.ts", "export const chart = 1;");
      write(
        "packages/features/agent/web/tests/fixtures/valid/index.ts",
        'import { chart } from "../../../src/charts/chart";\nexport const valid = chart;\n',
      );
      write(
        "packages/features/agent/web/tests/fixtures/invalid/index.ts",
        'import { chart } from "../../../src/charts/chart";\nexport const invalid = chart;\n',
      );

      const plan = planTestColocation(root);

      expect(plan.collisions).toEqual([]);
      expect(relativeMoves()).toEqual([
        [
          "packages/features/agent/web/tests/fixtures/invalid/index.ts",
          "packages/features/agent/web/src/charts/__tests__/fixtures/invalid/index.ts",
        ],
        [
          "packages/features/agent/web/tests/fixtures/valid/index.ts",
          "packages/features/agent/web/src/charts/__tests__/fixtures/valid/index.ts",
        ],
      ]);
    });
  });

  describe("given a helper shared by the tests", () => {
    it("moves it into the __tests__ of the first test that imports it, keeping its path", () => {
      root = mkdtempSync(join("/tmp", "langwatch-test-colocation-"));
      featurePackage("agent", "server");
      write(
        "packages/features/agent/server/src/services/agent.service.ts",
        "export class AgentService {}",
      );
      write("packages/features/agent/server/tests/support/stub.ts", "export const stub = 1;");
      write(
        "packages/features/agent/server/tests/agent.service.unit.test.ts",
        'import { AgentService } from "../src/services/agent.service";\nimport { stub } from "./support/stub";\n',
      );

      expect(relativeMoves()).toEqual([
        [
          "packages/features/agent/server/tests/agent.service.unit.test.ts",
          "packages/features/agent/server/src/services/__tests__/agent.service.unit.test.ts",
        ],
        [
          "packages/features/agent/server/tests/support/stub.ts",
          "packages/features/agent/server/src/services/__tests__/support/stub.ts",
        ],
      ]);
    });
  });

  describe("given a test that names nothing under src", () => {
    /**
     * A test moved to a guessed home is worse than one that stayed put: after
     * the move the guess reads as a deliberate statement about what the test
     * covers, and there is nothing left to say it was not.
     */
    it("reports it unresolved and leaves it where it is", () => {
      root = mkdtempSync(join("/tmp", "langwatch-test-colocation-"));
      featurePackage("agent", "server");
      write(
        "packages/features/agent/server/src/services/agent.service.ts",
        "export class AgentService {}",
      );
      write(
        "packages/features/agent/server/tests/docs-shape.unit.test.ts",
        'import { readFileSync } from "node:fs";\nreadFileSync("README.md");\n',
      );

      const plan = planTestColocation(root);

      expect(plan.moves).toEqual([]);
      expect(plan.unresolved).toHaveLength(1);
      expect(plan.unresolved[0]!.file).toContain("docs-shape.unit.test.ts");
      expect(plan.unresolved[0]!.reason).toContain("names no module under src/");
    });
  });

  describe("given two tests of one module with the same filename", () => {
    it("reports the collision rather than letting one overwrite the other", () => {
      root = mkdtempSync(join("/tmp", "langwatch-test-colocation-"));
      featurePackage("agent", "server");
      write(
        "packages/features/agent/server/src/services/agent.service.ts",
        "export class AgentService {}",
      );
      write(
        "packages/features/agent/server/tests/a/agent.service.unit.test.ts",
        'import { AgentService } from "../../src/services/agent.service";\n',
      );
      write(
        "packages/features/agent/server/tests/b/agent.service.unit.test.ts",
        'import { AgentService } from "../../src/services/agent.service";\n',
      );

      const plan = planTestColocation(root);

      expect(plan.collisions).toHaveLength(1);
      expect(plan.collisions[0]).toContain("both target");
    });
  });

  describe("given a package with no tests directory", () => {
    it("plans nothing for it", () => {
      root = mkdtempSync(join("/tmp", "langwatch-test-colocation-"));
      featurePackage("agent", "server");
      write(
        "packages/features/agent/server/src/services/agent.service.ts",
        "export class AgentService {}",
      );

      expect(planTestColocation(root).moves).toEqual([]);
    });
  });
});
