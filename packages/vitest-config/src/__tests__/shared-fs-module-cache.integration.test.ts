import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Exercises LangWatch's patch to Vitest's fsModuleCache (patches/vitest@5.0.1.patch,
// ADR-185): two checkouts of the same files share one cache directory. Each
// checkout is a workspace of its own, run by a child Vitest, so the cache, the
// workspace root and the worker are all real.

const run = promisify(execFile);
const vitestBin = join(
  dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

const HELPER = `// the throw is on line 3
export function explode(): never {
  throw new Error("explode");
}
export const where = "file";
`;
const PROBE = `import { explode, where } from "./helper";

test("throws from the helper", () => {
  explode();
});

test("reads its own checkout's path", () => {
  expect(import.meta.filename.startsWith(process.env.CHECKOUT_ROOT)).toBe(true);
});

test("imports the helper this checkout has", () => {
  expect(where).toBe(process.env.EXPECTED_WHERE);
});
`;

interface CheckoutRun {
  results: Record<string, { status: string; failureMessages: string[] }>;
  cacheLog: string;
}

describe("the shared fs module cache", () => {
  let base: string;
  let cacheDir: string;

  const checkout = (name: string, files: Record<string, string>) => {
    const root = join(base, name);
    const all: Record<string, string> = {
      "pnpm-workspace.yaml": "packages: []\n",
      "package.json": '{ "name": "probe", "type": "module" }\n',
      "vitest.config.mjs":
        "export default { test: { fsModuleCache: true, globals: true, maxWorkers: 1 } };\n",
      "src/probe.test.ts": PROBE,
      ...files,
    };
    for (const [file, body] of Object.entries(all)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), body);
    }
    return root;
  };

  const runVitest = async (root: string, expectedWhere: string): Promise<CheckoutRun> => {
    const report = join(root, "report.json");
    const child = await run(
      process.execPath,
      [vitestBin, "run", "--root", root, "--reporter=json", `--outputFile=${report}`],
      {
        cwd: root,
        env: {
          ...process.env,
          VITEST_FS_MODULE_CACHE_DIR: cacheDir,
          VITEST_FS_MODULE_CACHE_ROOT: "",
          // a child of a run that already holds a machine slot
          LANGWATCH_VITEST_SLOT: "held-by-parent",
          DEBUG: "vitest:cache:fs",
          CHECKOUT_ROOT: root,
          EXPECTED_WHERE: expectedWhere,
        },
      },
    ).catch((error: { stdout: string; stderr: string }) => error);
    const json = JSON.parse(readFileSync(report, "utf8")) as {
      testResults: {
        assertionResults: { title: string; status: string; failureMessages: string[] }[];
      }[];
    };
    const results: CheckoutRun["results"] = {};
    for (const file of json.testResults) {
      for (const test of file.assertionResults) results[test.title] = test;
    }
    return { results, cacheLog: child.stderr };
  };

  const cachedFiles = () =>
    readdirSync(cacheDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== "_metadata.json")
      .map((entry) => join(entry.parentPath, entry.name));

  let first: CheckoutRun;
  let firstRoot: string;
  let second: CheckoutRun;
  let secondRoot: string;
  let writtenByFirst: { file: string; mtimeMs: number }[];

  beforeAll(async () => {
    // real, so it matches the module ids Vite resolves (macOS links /var to /private/var)
    base = realpathSync(mkdtempSync(join(tmpdir(), "shared-fs-module-cache-")));
    cacheDir = join(base, "cache");
    firstRoot = checkout("first", { "src/helper.ts": HELPER });
    secondRoot = checkout("second", { "src/helper.ts": HELPER });
    first = await runVitest(firstRoot, "file");
    writtenByFirst = cachedFiles().map((file) => ({ file, mtimeMs: statSync(file).mtimeMs }));
    second = await runVitest(secondRoot, "file");
  }, 90_000);

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe("given a checkout that filled the cache", () => {
    /** @scenario "A second checkout's first run reads what the first checkout transformed" */
    it("stores the transformed modules without the checkout's path", () => {
      expect(writtenByFirst.length).toBeGreaterThanOrEqual(2);
      for (const { file } of writtenByFirst) {
        expect(readFileSync(file, "utf8")).not.toContain(firstRoot);
      }
    });

    /** @scenario "A second checkout's first run reads what the first checkout transformed" */
    it("serves a second checkout from the cache without transforming again", () => {
      expect(second.cacheLog).toContain(`[read] ${join(secondRoot, "src/probe.test.ts")}`);
      expect(second.cacheLog).not.toContain("[write]");
      expect(cachedFiles().map((file) => ({ file, mtimeMs: statSync(file).mtimeMs }))).toEqual(
        writtenByFirst,
      );
    });
  });

  describe("when a test fails in the second checkout", () => {
    /** @scenario "Stack traces and module paths name the checkout that runs the test" */
    it("points the stack trace at the second checkout's files and lines", () => {
      const failure = second.results["throws from the helper"]?.failureMessages.join("\n");

      expect(failure).toContain(`${join(secondRoot, "src/helper.ts")}:3:9`);
      expect(failure).toContain(`${join(secondRoot, "src/probe.test.ts")}:4:3`);
      expect(failure).not.toContain(firstRoot);
    });

    /** @scenario "Stack traces and module paths name the checkout that runs the test" */
    it("gives the module its own checkout's import.meta paths", () => {
      expect(first.results["reads its own checkout's path"]?.status).toBe("passed");
      expect(second.results["reads its own checkout's path"]?.status).toBe("passed");
    });
  });

  describe("when the second checkout resolves an import to a different file", () => {
    /** @scenario "A cached module whose import is missing here is transformed again" */
    it("transforms the importer again instead of importing a missing file", async () => {
      const movedRoot = checkout("moved", {
        "src/helper/index.ts": HELPER.replace('"file"', '"directory"'),
      });

      const moved = await runVitest(movedRoot, "directory");

      expect(moved.cacheLog).toContain("doesn't exist here, re-transforming");
      expect(moved.results["imports the helper this checkout has"]?.status).toBe("passed");
    }, 60_000);
  });
});
