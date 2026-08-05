/**
 * The mock-specifier rule and its enforcement.
 *
 * The snippet cases pin the rule itself, so it cannot regress to finding
 * nothing; the last cases run it over every tracked test file, which is
 * what actually keeps a mock that names no module out. Both ride the
 * ordinary unit shards, so there is no gate that can quietly stop checking.
 *
 * Spec: specs/setup/test-mock-specifier-resolution.feature
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  aliasesForFile,
  type ModuleAlias,
  parseVitestConfigAliases,
  resolveMockSpecifier,
  scanSourceForMockSpecifiers,
} from "../mockSpecifierScan";

/** platform/app/, from src/test-utils/__tests__/. */
const APP_ROOT = resolve(__dirname, "../../..");

/** The workspace root, which is two levels above the app. */
const REPO_ROOT = resolve(APP_ROOT, "../..");

const TEST_FILE_PATTERN = /\.(test|spec)\.(c|m)?[jt]sx?$/;
const VITEST_CONFIG_PATTERN = /(^|\/)vitest[^/]*\.config\.(c|m)?[jt]s$/;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "buffer",
    maxBuffer: 128 * 1024 * 1024,
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

/**
 * Alias tables keyed by the directory of the config declaring them, read
 * from the configs themselves so a table added or renamed there travels
 * here without anyone remembering to copy it.
 */
function readAliasTables(files: string[]): Map<string, ModuleAlias[]> {
  const tables = new Map<string, ModuleAlias[]>();
  for (const relativePath of files) {
    if (!VITEST_CONFIG_PATTERN.test(relativePath)) continue;
    const fileName = join(REPO_ROOT, relativePath);
    const configDir = dirname(fileName);
    const parsed = parseVitestConfigAliases({
      fileName,
      sourceText: readFileSync(fileName, "utf8"),
      configDir,
    });
    tables.set(configDir, [...(tables.get(configDir) ?? []), ...parsed]);
  }
  return tables;
}

type Offender = {
  location: string;
  specifier: string;
};

function offendersIn({
  relativePath,
  aliasesByConfigDir,
}: {
  relativePath: string;
  aliasesByConfigDir: Map<string, ModuleAlias[]>;
}): Offender[] {
  const fileName = join(REPO_ROOT, relativePath);
  const sourceText = readFileSync(fileName, "utf8");
  if (!sourceText.includes("mock")) return [];

  const aliases = aliasesForFile({ file: fileName, aliasesByConfigDir });
  const offenders: Offender[] = [];
  for (const site of scanSourceForMockSpecifiers(fileName, sourceText)) {
    const resolution = resolveMockSpecifier({
      specifier: site.specifier,
      fromDir: dirname(fileName),
      aliases,
    });
    if (resolution.kind !== "missing") continue;
    offenders.push({
      location: `${relativePath}:${site.line}`,
      specifier: site.specifier ?? "<computed>",
    });
  }
  return offenders;
}

/**
 * Scan every tracked test file, returning what was found rather than
 * asserting on it: the counts are the caller's proof the walk still sees a
 * tree, and the offenders are what the rule is about.
 */
function scanTrackedTestFiles(): {
  configDirCount: number;
  aliasCount: number;
  testFileCount: number;
  offenders: string[];
} {
  const files = trackedFiles();
  const aliasesByConfigDir = readAliasTables(files);
  const testFiles = files.filter((file) => TEST_FILE_PATTERN.test(file));

  const offenders: string[] = [];
  for (const relativePath of testFiles) {
    for (const offender of offendersIn({ relativePath, aliasesByConfigDir })) {
      offenders.push(`${offender.location} vi.mock("${offender.specifier}")`);
    }
  }

  return {
    configDirCount: aliasesByConfigDir.size,
    aliasCount: [...aliasesByConfigDir.values()].flat().length,
    testFileCount: testFiles.length,
    offenders,
  };
}

const scan = (sourceText: string) =>
  scanSourceForMockSpecifiers("virtual.test.ts", sourceText);

const APP_ALIASES: ModuleAlias[] = [
  { find: "~/", replacement: join(APP_ROOT, "src/") },
];

const resolveIn = ({
  specifier,
  fromDir,
  exists,
}: {
  specifier: string | undefined;
  fromDir: string;
  exists: string[];
}) =>
  resolveMockSpecifier({
    specifier,
    fromDir,
    aliases: APP_ALIASES,
    fileExists: (path) => exists.includes(path),
  });

describe("the mock-specifier rule", () => {
  describe("given a plain string specifier", () => {
    /** @scenario "A mock naming a module that exists passes the check" */
    it("reports the module it names and the line it sits on", () => {
      expect(
        scan(['vi.mock("../ui/toaster", () => ({}));'].join("\n")),
      ).toEqual([{ line: 1, specifier: "../ui/toaster" }]);
    });
  });

  describe("given the Vitest typed form", () => {
    /** @scenario "A mock written in the typed import form is still checked" */
    it("reads the module out of the import call", () => {
      expect(scan('vi.mock(import("../ui/toaster"), () => ({}));')).toEqual([
        { line: 1, specifier: "../ui/toaster" },
      ]);
    });
  });

  describe("given doMock and unmock", () => {
    it("reads them the same way as mock", () => {
      const found = scan(
        ['vi.doMock("./a");', 'vi.unmock("./b");', "vi.mocked(thing);"].join(
          "\n",
        ),
      );

      expect(found).toEqual([
        { line: 1, specifier: "./a" },
        { line: 2, specifier: "./b" },
      ]);
    });
  });

  describe("given a specifier mentioned in prose rather than called", () => {
    /** @scenario "A specifier named only in a comment is not a call site" */
    it("is not treated as a call site", () => {
      const found = scan(
        [
          "// vi.mock('../ui/toaster') used to live here",
          '/** vi.mock("../ui/drawer") */',
          "const note = 'vi.mock(\"../ui/checkbox\")';",
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });

  describe("given a specifier built at runtime", () => {
    it("records the call without a module name", () => {
      expect(scan("vi.mock(modulePath, () => ({}));")).toEqual([
        { line: 1, specifier: undefined },
      ]);
    });

    it("resolves to nothing to answer for", () => {
      expect(
        resolveIn({ specifier: undefined, fromDir: APP_ROOT, exists: [] }),
      ).toEqual({ kind: "dynamic" });
    });
  });
});

describe("resolving a mock specifier", () => {
  describe("given a bare package specifier", () => {
    /** @scenario "A mock naming an installed package is left to node" */
    it("leaves it to node rather than looking for a file", () => {
      expect(
        resolveIn({
          specifier: "@chakra-ui/react",
          fromDir: join(APP_ROOT, "src/components"),
          exists: [],
        }),
      ).toEqual({ kind: "package" });
    });
  });

  describe("given a relative specifier with no extension", () => {
    it("finds the TypeScript file it names", () => {
      const file = join(APP_ROOT, "src/components/ui/toaster.tsx");

      expect(
        resolveIn({
          specifier: "../ui/toaster",
          fromDir: join(APP_ROOT, "src/components/suites"),
          exists: [file],
        }),
      ).toEqual({ kind: "resolved", file });
    });

    it("finds the directory index it names", () => {
      const file = join(APP_ROOT, "src/features/errors/index.ts");

      expect(
        resolveIn({
          specifier: "../errors",
          fromDir: join(APP_ROOT, "src/features/traces-v2"),
          exists: [file],
        }),
      ).toEqual({ kind: "resolved", file });
    });
  });

  describe("given a NodeNext specifier ending in .js", () => {
    /** @scenario "A mock written the NodeNext way resolves to its TypeScript source" */
    it("finds the TypeScript source that emits it", () => {
      const file = join(APP_ROOT, "src/server/db.ts");

      expect(
        resolveIn({
          specifier: "./db.js",
          fromDir: join(APP_ROOT, "src/server"),
          exists: [file],
        }),
      ).toEqual({ kind: "resolved", file });
    });
  });

  describe("given an aliased specifier", () => {
    it("expands the alias before looking", () => {
      const file = join(APP_ROOT, "src/server/db.ts");

      expect(
        resolveIn({
          specifier: "~/server/db",
          fromDir: join(APP_ROOT, "src/components/suites/__tests__"),
          exists: [file],
        }),
      ).toEqual({ kind: "resolved", file });
    });
  });

  describe("given a specifier one directory level off", () => {
    /** @scenario "A mock naming no module at all fails the check" */
    it("reports it as naming nothing", () => {
      const resolution = resolveIn({
        specifier: "../ui/toaster",
        fromDir: join(APP_ROOT, "src/components/suites/__tests__"),
        exists: [join(APP_ROOT, "src/components/ui/toaster.tsx")],
      });

      expect(resolution.kind).toBe("missing");
    });
  });
});

describe("reading a vitest config's alias table", () => {
  const parse = (sourceText: string) =>
    parseVitestConfigAliases({
      fileName: join(APP_ROOT, "vitest.config.ts"),
      sourceText,
      configDir: APP_ROOT,
    });

  describe("given the table the app's configs declare", () => {
    /** @scenario "The check reads the alias table from the vitest configs" */
    it("expands each entry against the config's own directory", () => {
      expect(
        parse(
          [
            "export default defineConfig({",
            "  resolve: {",
            "    alias: {",
            '      "~/": join(__dirname, "./src/"),',
            '      "@ee/": join(__dirname, "./ee/"),',
            "    },",
            "  },",
            "});",
          ].join("\n"),
        ),
      ).toEqual([
        { find: "~/", replacement: join(APP_ROOT, "src/") },
        { find: "@ee/", replacement: join(APP_ROOT, "ee/") },
      ]);
    });
  });

  describe("given the array table vite also accepts", () => {
    /** @scenario "The check reads the alias table from the vitest configs" */
    it("reads each find and replacement pair", () => {
      expect(
        parse(
          [
            "export default defineConfig({",
            "  resolve: {",
            "    alias: [",
            '      { find: "~", replacement: resolve(__dirname, "./src") },',
            "    ],",
            "  },",
            "});",
          ].join("\n"),
        ),
      ).toEqual([{ find: "~", replacement: join(APP_ROOT, "src") }]);
    });
  });

  describe("given an entry built in a shape the reader does not know", () => {
    it("fails loudly rather than dropping the entry", () => {
      expect(() =>
        parse(
          [
            "export default defineConfig({",
            "  resolve: {",
            '    alias: { "~/": buildSomehow() },',
            "  },",
            "});",
          ].join("\n"),
        ),
      ).toThrow(/cannot read/);
    });

    it("fails loudly on a table that is neither an object nor an array", () => {
      expect(() =>
        parse(
          [
            "export default defineConfig({",
            "  resolve: { alias: sharedAliases },",
            "});",
          ].join("\n"),
        ),
      ).toThrow(/neither an object nor an array/);
    });

    it("fails loudly on an entry spread in from elsewhere", () => {
      expect(() =>
        parse(
          [
            "export default defineConfig({",
            "  resolve: { alias: { ...sharedAliases } },",
            "});",
          ].join("\n"),
        ),
      ).toThrow(/not a simple/);
    });

    it("fails loudly on a regular-expression find, which cannot be prefix-matched", () => {
      expect(() =>
        parse(
          [
            "export default defineConfig({",
            "  resolve: {",
            '    alias: [{ find: /^~\\//, replacement: "./src/" }],',
            "  },",
            "});",
          ].join("\n"),
        ),
      ).toThrow(/find is not a string literal/);
    });

    it("fails loudly on an entry carrying a custom resolver", () => {
      expect(() =>
        parse(
          [
            "export default defineConfig({",
            "  resolve: {",
            "    alias: [",
            '      { find: "~", replacement: "./src", customResolver: r },',
            "    ],",
            "  },",
            "});",
          ].join("\n"),
        ),
      ).toThrow(/customResolver/);
    });

    it("fails loudly on a config whose table is partly in another file", () => {
      expect(() =>
        parse(
          [
            "export default mergeConfig(",
            "  baseConfig,",
            '  defineConfig({ resolve: { alias: { "~/": "./src/" } } }),',
            ");",
          ].join("\n"),
        ),
      ).toThrow(/mergeConfig/);
    });
  });
});

describe("every tracked test file", () => {
  let result: ReturnType<typeof scanTrackedTestFiles>;

  // In `beforeAll` rather than the describe body: the walk shells out to git
  // and reads the whole tree, and both it and the alias reader can throw. In
  // the body those throws abort collection and surface as a file-level error
  // with no test name attached.
  beforeAll(() => {
    result = scanTrackedTestFiles();
  });

  describe("given the walk itself", () => {
    it("sees the test tree and the alias tables", () => {
      // Lower bounds that prove the walk found something, not a census of
      // the tree: a count that tracks the repo goes stale on every merge and
      // fails outright on a partial checkout.
      expect(result.testFileCount).toBeGreaterThan(100);
      expect(result.configDirCount).toBeGreaterThan(5);
      expect(result.aliasCount).toBeGreaterThan(5);
    });
  });

  describe("given every mock call in that tree", () => {
    /** @scenario "A mock naming no module at all fails the check" */
    it("names a module that exists", () => {
      expect(result.offenders).toEqual([]);
    });
  });
});
