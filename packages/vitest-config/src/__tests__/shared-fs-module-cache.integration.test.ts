import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// LangWatch's fsModuleCache patch (ADR-193): two checkouts share one cache, each run
// by a child Vitest from a package below its workspace root, importing a workspace
// file and an installed package, so the code names both by `/@fs/<checkout>/...`.

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
const DEP = 'export const dep = "installed";\n';
const PROBE = `import { explode, where } from "../../shared/helper";
import { dep } from "probe-dep";

test("throws from the helper", () => {
  explode();
});

test("reads its own checkout's path", () => {
  expect(import.meta.filename.startsWith(process.env.CHECKOUT_ROOT)).toBe(true);
});

test("imports the helper this checkout has", () => {
  expect(where).toBe(process.env.EXPECTED_WHERE);
});

test("imports an installed package", () => {
  expect(dep).toBe("installed");
});
`;

interface CheckoutRun {
  results: Record<string, { status: string; failureMessages: string[] }>;
  cacheLog: string;
}

describe("the shared fs module cache", () => {
  let base: string;
  let cacheDir: string;

  const checkout = (
    name: string,
    files: Record<string, string>,
    fsModuleCache = true,
    extraConfig = "",
  ) => {
    const root = join(base, name);
    const all: Record<string, string> = {
      "pnpm-workspace.yaml": "packages: [pkg]\n",
      "package.json": '{ "name": "probe-workspace", "private": true }\n',
      "node_modules/probe-dep/package.json":
        '{ "name": "probe-dep", "type": "module", "exports": "./index.js" }\n',
      "node_modules/probe-dep/index.js": DEP,
      "pkg/package.json": '{ "name": "probe", "type": "module" }\n',
      "pkg/vitest.config.mjs": `export default { test: { fsModuleCache: ${fsModuleCache}, ${extraConfig} globals: true, maxWorkers: 1 } };\n`,
      "pkg/src/probe.test.ts": PROBE,
      ...files,
    };
    for (const [file, body] of Object.entries(all)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), body);
    }
    return root;
  };

  const runVitest = async (
    root: string,
    expectedWhere: string,
    cache: string | null = cacheDir,
    extraEnv: Record<string, string> = {},
  ): Promise<CheckoutRun> => {
    const report = join(root, "report.json");
    const child = await run(
      process.execPath,
      [vitestBin, "run", "--root", join(root, "pkg"), "--reporter=json", `--outputFile=${report}`],
      {
        cwd: join(root, "pkg"),
        env: {
          ...process.env,
          VITEST_FS_MODULE_CACHE_DIR: cache ?? "",
          VITEST_FS_MODULE_CACHE_ROOT: "",
          ...extraEnv,
          // a child of a run that already holds a machine slot
          LANGWATCH_VITEST_SLOT: "held-by-parent",
          DEBUG: "vitest:cache:fs",
          // the log is matched as plain text, so no colour codes in it
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          DEBUG_COLORS: "no",
          CHECKOUT_ROOT: root,
          EXPECTED_WHERE: expectedWhere,
        },
      },
    ).catch((error: { stdout: string; stderr: string }) => error);
    if (!existsSync(report)) {
      throw new Error(
        `the child Vitest wrote no report\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`,
      );
    }
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
    firstRoot = checkout("first", { "shared/helper.ts": HELPER });
    secondRoot = checkout("second", { "shared/helper.ts": HELPER });
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
        const stored = readFileSync(file, "utf8");
        expect(stored).not.toContain(firstRoot);
        // the inline source map is base64, out of reach of a plain-text check
        for (const [, encoded] of stored.matchAll(
          /sourceMappingURL=data:application\/json;base64,(\S+)/g,
        )) {
          expect(Buffer.from(encoded as string, "base64").toString("utf8")).not.toContain(
            firstRoot,
          );
        }
      }
    });

    /** @scenario "A second checkout's first run reads what the first checkout transformed" */
    it("serves a second checkout from the cache without transforming again", () => {
      expect(second.cacheLog).toContain(`[read] ${join(secondRoot, "pkg/src/probe.test.ts")}`);
      expect(second.cacheLog).not.toContain("[write]");
      expect(cachedFiles().map((file) => ({ file, mtimeMs: statSync(file).mtimeMs }))).toEqual(
        writtenByFirst,
      );
    });
  });

  describe("when a run imports modules it wrote to the cache itself", () => {
    /** @scenario "A run reads back the modules it cached itself" */
    it("imports the workspace file and the installed package in both checkouts", () => {
      for (const checkoutRun of [first, second]) {
        expect(checkoutRun.results["imports the helper this checkout has"]?.status).toBe("passed");
        expect(checkoutRun.results["imports an installed package"]?.status).toBe("passed");
      }
    });
  });

  describe("given a suite with fsModuleCache off", () => {
    /** @scenario "A suite with fsModuleCache off is untouched" */
    it("imports the workspace file and the installed package", async () => {
      const offRoot = checkout("off", { "shared/helper.ts": HELPER }, false);

      const off = await runVitest(offRoot, "file");

      const probeCopy = [...off.cacheLog.matchAll(/\[write\] (\S+) is cached in (\S+)/g)].find(
        ([, id]) => id === join(offRoot, "pkg/src/probe.test.ts"),
      )?.[2];
      expect(probeCopy).toBeDefined();
      expect(readFileSync(probeCopy as string, "utf8")).toContain(join(offRoot, "shared/helper"));
      expect(off.results["imports the helper this checkout has"]?.status).toBe("passed");
      expect(off.results["imports an installed package"]?.status).toBe("passed");
    }, 60_000);
  });

  describe("when a test fails in the second checkout", () => {
    /** @scenario "Stack traces and module paths name the checkout that runs the test" */
    it("points the stack trace at the second checkout's files and lines", () => {
      const failure = second.results["throws from the helper"]?.failureMessages.join("\n");

      expect(failure).toContain(`${join(secondRoot, "shared/helper.ts")}:3:9`);
      expect(failure).toContain(`${join(secondRoot, "pkg/src/probe.test.ts")}:5:3`);
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
        "shared/helper/index.ts": HELPER.replace('"file"', '"directory"'),
      });

      const moved = await runVitest(movedRoot, "directory");

      expect(moved.cacheLog).toContain("doesn't exist here, re-transforming");
      expect(moved.results["imports the helper this checkout has"]?.status).toBe("passed");
    }, 60_000);
  });

  describe("when a run starts", () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);
    const seedDirectory = (cache: string, name: string, age: Date) => {
      mkdirSync(join(cache, name), { recursive: true });
      writeFileSync(join(cache, name, "module"), "cached");
      utimesSync(join(cache, name), age, age);
    };

    /** @scenario "A run removes cache directories no run has used for a week" */
    it("removes the directory unused for a week and keeps the recent one", async () => {
      const pruneCache = join(base, "prune-cache");
      seedDirectory(pruneCache, "deadbeef", hoursAgo(8 * 24));
      seedDirectory(pruneCache, "cafef00d", hoursAgo(24));
      const pruneRoot = checkout("prune", { "shared/helper.ts": HELPER });

      await runVitest(pruneRoot, "file", pruneCache);

      const remaining = readdirSync(pruneCache);
      expect(remaining).not.toContain("deadbeef");
      expect(remaining).toContain("cafef00d");
      expect(remaining.filter((name) => name.startsWith(".removing-"))).toEqual([]);
    }, 60_000);

    /** @scenario "A lockfile change starts a new directory and leaves the other alone" */
    it("keeps this lockfile's modules in a directory of their own", async () => {
      const lockCache = join(base, "lock-cache");
      seedDirectory(lockCache, "cafef00d", hoursAgo(1));
      const lockRoot = checkout("lock", { "shared/helper.ts": HELPER });

      await runVitest(lockRoot, "file", lockCache);

      const own = readdirSync(lockCache).filter((name) => name !== "cafef00d");
      expect(own).toHaveLength(1);
      expect(readdirSync(join(lockCache, "cafef00d"))).toEqual(["module"]);
      // the shape the pruning pattern in the patch recognises, or the directory is never pruned
      expect(own[0]).toMatch(/^[0-9a-f_]{8}$/);
      expect(readdirSync(join(lockCache, own[0] as string)).length).toBeGreaterThan(1);
    }, 60_000);

    /** @scenario "Without VITEST_FS_MODULE_CACHE_DIR the cache lives under XDG_CACHE_HOME" */
    it("writes under XDG_CACHE_HOME when no cache directory is set", async () => {
      const xdg = join(base, "xdg-cache-home");
      const xdgRoot = checkout("xdg", { "shared/helper.ts": HELPER });

      await runVitest(xdgRoot, "file", null, { XDG_CACHE_HOME: xdg });

      const defaultRoot = join(xdg, "vitest", "fs-module-cache");
      const lockfileDirs = readdirSync(defaultRoot).filter((name) => /^[0-9a-f_]{8}$/.test(name));
      expect(lockfileDirs).toHaveLength(1);
      expect(readdirSync(join(defaultRoot, lockfileDirs[0] as string)).length).toBeGreaterThan(1);
    }, 60_000);

    /** @scenario "Without XDG_CACHE_HOME either the cache lives under ~/.cache" */
    it("writes under the home directory's .cache when XDG_CACHE_HOME is unset", async () => {
      const home = join(base, "home");
      const homeRoot = checkout("home-default", { "shared/helper.ts": HELPER });

      await runVitest(homeRoot, "file", null, { XDG_CACHE_HOME: "", HOME: home });

      const defaultRoot = join(home, ".cache", "vitest", "fs-module-cache");
      const lockfileDirs = readdirSync(defaultRoot).filter((name) => /^[0-9a-f_]{8}$/.test(name));
      expect(lockfileDirs).toHaveLength(1);
      expect(readdirSync(join(defaultRoot, lockfileDirs[0] as string)).length).toBeGreaterThan(1);
    }, 60_000);

    /** @scenario "A checkout's old node_modules cache is removed" */
    it("removes the checkout's own node_modules/.vitest-cache", async () => {
      const legacyRoot = checkout("legacy", {
        "shared/helper.ts": HELPER,
        "node_modules/.vitest-cache/old-module": "stale",
      });

      await runVitest(legacyRoot, "file", join(base, "legacy-cache"));

      expect(existsSync(join(legacyRoot, "node_modules/.vitest-cache"))).toBe(false);
    }, 60_000);

    /** @scenario "A config's fsModuleCachePath keeps its cache and leaves node_modules alone" */
    it("leaves node_modules/.vitest-cache alone when the config sets fsModuleCachePath", async () => {
      const ownCache = join(base, "own-cache");
      const ownRoot = checkout(
        "own-path",
        { "shared/helper.ts": HELPER, "node_modules/.vitest-cache/old-module": "kept" },
        true,
        `fsModuleCachePath: ${JSON.stringify(ownCache)},`,
      );

      await runVitest(ownRoot, "file", join(base, "unused-cache"));

      expect(existsSync(join(ownRoot, "node_modules/.vitest-cache/old-module"))).toBe(true);
      expect(readdirSync(ownCache).length).toBeGreaterThan(0);
    }, 60_000);
  });

  describe("when a module's cache key depends on more than its source", () => {
    const fresh = (name: string) => join(base, name);
    const probeLine = (root: string) => join(root, "pkg/src/probe.test.ts");
    const helperLine = (root: string) => join(root, "shared/helper.ts");

    /** @scenario "A second checkout with a different tsconfig does not reuse the first's entry" */
    it("transforms again when the nearest tsconfig differs", async () => {
      const cache = fresh("tsconfig-cache");
      const tsconfig = (target: string) => JSON.stringify({ compilerOptions: { target } });
      const a = checkout("tsconfig-a", {
        "shared/helper.ts": HELPER,
        "pkg/tsconfig.json": tsconfig("es2022"),
      });
      const b = checkout("tsconfig-b", {
        "shared/helper.ts": HELPER,
        "pkg/tsconfig.json": tsconfig("es2020"),
      });
      const same = checkout("tsconfig-same", {
        "shared/helper.ts": HELPER,
        "pkg/tsconfig.json": tsconfig("es2022"),
      });

      await runVitest(a, "file", cache);
      const different = await runVitest(b, "file", cache);
      const identical = await runVitest(same, "file", cache);

      expect(different.cacheLog).toContain(`[write] ${probeLine(b)} is cached in ${cache}`);
      expect(different.cacheLog).not.toContain(`[read] ${probeLine(b)}`);
      expect(identical.cacheLog).toContain(`[read] ${probeLine(same)}`);
    }, 120_000);

    /** @scenario "A module whose source names the first checkout's path is not reused by the second" */
    it("keeps a module that names the checkout's root out of the other checkout's reads", async () => {
      const cache = fresh("pinned-cache");
      const pinnedFirstRoot = fresh("pinned-first");
      const helper = `${HELPER}// built at ${pinnedFirstRoot}\n`;
      const pinnedFirst = checkout("pinned-first", { "shared/helper.ts": helper });
      const pinnedSecond = checkout("pinned-second", { "shared/helper.ts": helper });

      await runVitest(pinnedFirst, "file", cache);
      const secondRun = await runVitest(pinnedSecond, "file", cache);

      expect(secondRun.cacheLog).toContain(
        `[write] ${helperLine(pinnedSecond)} is cached in ${cache}`,
      );
      expect(secondRun.cacheLog).not.toContain(`[read] ${helperLine(pinnedSecond)}`);
      expect(secondRun.results["imports the helper this checkout has"]?.status).toBe("passed");
    }, 120_000);

    /** @scenario "A module whose source contains the cache's root token is never cached" */
    it("never caches a module whose source contains the root token", async () => {
      const cache = fresh("token-cache");
      // built in two parts: a literal token in this file would be rewritten by the cache
      // the test itself runs under
      const token = ["@@vitest-fs-module", "cache-root@@"].join("-");
      const helper = HELPER.replace('"file"', `"${token}"`);
      const first = checkout("token-first", { "shared/helper.ts": helper });
      const second = checkout("token-second", { "shared/helper.ts": helper });

      const firstRun = await runVitest(first, token, cache);
      const secondRun = await runVitest(second, token, cache);

      for (const [root, log] of [
        [first, firstRun.cacheLog],
        [second, secondRun.cacheLog],
      ] as const) {
        // the forks pool's own temporary copy is logged as a write too, so only
        // a write into the shared cache counts
        expect(log).not.toContain(`[write] ${helperLine(root)} is cached in ${cache}`);
        expect(log).not.toContain(`[read] ${helperLine(root)}`);
      }
      // the temporary copy is not portable, so the worker leaves the token as written
      for (const { results } of [firstRun, secondRun]) {
        expect(results["imports the helper this checkout has"]?.status).toBe("passed");
      }
    }, 120_000);
  });

  describe("when a module outside the checkout has a source map naming the checkout", () => {
    /** @scenario "A module outside the checkout keeps no checkout path in its stored source map" */
    it("stores the module without the checkout's path in its inline source map", async () => {
      const cache = join(base, "outside-cache");
      const outsideRoot = join(base, "outside-root");
      const map = {
        version: 3,
        sources: [join(outsideRoot, "shared/outside.ts")],
        names: [],
        mappings: "AAAA",
      };
      const lib = `export const outside = "outside";\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}\n`;
      mkdirSync(join(base, "outside-lib"), { recursive: true });
      writeFileSync(join(base, "outside-lib", "lib.js"), lib);
      checkout("outside-root", {
        "shared/helper.ts": HELPER,
        "pkg/src/outside.test.ts": `import { outside } from "../../../outside-lib/lib.js";
test("imports the module outside the checkout", () => {
  expect(outside).toBe("outside");
});
`,
      });

      const outsideRun = await runVitest(outsideRoot, "file", cache);

      const stored = [...outsideRun.cacheLog.matchAll(/\[write\] (\S+) is cached in (\S+)/g)].find(
        ([, id, path]) => id === join(base, "outside-lib", "lib.js") && path?.startsWith(cache),
      )?.[2];
      expect(stored).toBeDefined();
      // a source made relative to the module's directory would still name the checkout
      const maps = [
        ...readFileSync(stored as string, "utf8").matchAll(
          /sourceMappingURL=data:application\/json;base64,(\S+)/g,
        ),
      ].map(([, encoded]) => Buffer.from(encoded as string, "base64").toString("utf8"));
      for (const decoded of maps) expect(decoded).not.toContain("outside-root");
      expect(outsideRun.results["imports the module outside the checkout"]?.status).toBe("passed");
    }, 60_000);
  });

  describe("when the main process loads a module the first checkout cached", () => {
    const GLOBAL_SETUP = `import { writeFileSync } from "node:fs";
import { where } from "../shared/helper";
export default function () {
  writeFileSync(process.env.CHECKOUT_ROOT + "/global-setup.txt", where);
}
`;

    /** @scenario "The main process loads a cached global setup in its own checkout" */
    it("imports the global setup's workspace file in both checkouts", async () => {
      const cache = join(base, "main-runner-cache");
      const extra = 'globalSetup: ["./global-setup.ts"],';
      // the helpers differ, so each global setup's output shows whose helper it imported
      const first = checkout(
        "main-runner-first",
        { "shared/helper.ts": HELPER, "pkg/global-setup.ts": GLOBAL_SETUP },
        true,
        extra,
      );
      const second = checkout(
        "main-runner-second",
        {
          "shared/helper.ts": HELPER.replace('"file"', '"second"'),
          "pkg/global-setup.ts": GLOBAL_SETUP,
        },
        true,
        extra,
      );

      await runVitest(first, "file", cache);
      const secondRun = await runVitest(second, "second", cache);

      expect(secondRun.cacheLog).toContain(`[read] ${join(second, "pkg/global-setup.ts")}`);
      // the entry is portable, so the main process puts each checkout's root back too
      expect(readFileSync(join(first, "global-setup.txt"), "utf8")).toBe("file");
      expect(readFileSync(join(second, "global-setup.txt"), "utf8")).toBe("second");
    }, 120_000);
  });
});
