/**
 * The mock-specifier rule and its enforcement.
 *
 * The snippet cases pin the rule itself, so it cannot regress to finding
 * nothing; the last cases run it over every tracked test file, which is
 * what actually keeps a mock that names no module out. Both ride the
 * ordinary unit shards, so there is no gate that can quietly stop checking.
 *
 * The alias-table reader this resolves against is covered separately, in
 * `vitestAliasTable.unit.test.ts`.
 *
 * Spec: specs/setup/test-mock-specifier-resolution.feature
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  mightContainMockCall,
  resolveMockSpecifier,
  scanSourceForMockSpecifiers,
} from "../mockSpecifierScan";
import {
  aliasesForFile,
  type ModuleAlias,
  parseVitestConfigAliases,
} from "../vitestAliasTable";

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

function offendersIn({
  relativePath,
  aliasesByConfigDir,
}: {
  relativePath: string;
  aliasesByConfigDir: Map<string, ModuleAlias[]>;
}): string[] {
  const fileName = join(REPO_ROOT, relativePath);
  const sourceText = readFileSync(fileName, "utf8");
  if (!mightContainMockCall({ sourceText })) return [];

  const aliases = aliasesForFile({ file: fileName, aliasesByConfigDir });
  const offenders: string[] = [];
  for (const site of scanSourceForMockSpecifiers({ fileName, sourceText })) {
    const resolution = resolveMockSpecifier({
      specifier: site.specifier,
      fromDir: dirname(fileName),
      aliases,
    });
    if (resolution.kind !== "missing") continue;
    offenders.push(
      `${relativePath}:${site.line} vi.mock("${site.specifier ?? "<computed>"}")`,
    );
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
    offenders.push(...offendersIn({ relativePath, aliasesByConfigDir }));
  }

  return {
    configDirCount: aliasesByConfigDir.size,
    aliasCount: [...aliasesByConfigDir.values()].flat().length,
    testFileCount: testFiles.length,
    offenders,
  };
}

const scan = (sourceText: string) =>
  scanSourceForMockSpecifiers({ fileName: "virtual.test.ts", sourceText });

const APP_ALIASES: ModuleAlias[] = [
  { find: "~/", replacement: join(APP_ROOT, "src/") },
];

const resolveIn = ({
  specifier,
  fromDir,
  exists,
  aliases = APP_ALIASES,
}: {
  specifier: string | undefined;
  fromDir: string;
  exists: string[];
  aliases?: ModuleAlias[];
}) =>
  resolveMockSpecifier({
    specifier,
    fromDir,
    aliases,
    fileExists: (path) => exists.includes(path),
  });

describe("the mock-specifier rule", () => {
  describe("given a plain string specifier", () => {
    /** @scenario "A mock naming a module that exists passes the check" */
    it("reports the module it names and the line it sits on", () => {
      expect(scan('vi.mock("../ui/toaster", () => ({}));')).toEqual([
        { line: 1, specifier: "../ui/toaster" },
      ]);
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

  describe("given the pre-filter that decides whether to parse a file", () => {
    /** @scenario "A mock written with doMock is checked like any other" */
    it("lets a file through for every method the rule covers", () => {
      // `vi.doMock` carries no lowercase "mock", so a filter looking for that
      // substring drops the file before the rule ever sees it.
      expect('vi.doMock("./a");'.includes("mock")).toBe(false);

      for (const call of [
        'vi.mock("./a");',
        'vi.doMock("./a");',
        'vi.unmock("./a");',
        'vi.doUnmock("./a");',
      ]) {
        expect(mightContainMockCall({ sourceText: call })).toBe(true);
      }
    });

    it("skips a file with no mock call in it", () => {
      expect(
        mightContainMockCall({ sourceText: 'it("adds", () => {});' }),
      ).toBe(false);
    });
  });

  describe("given a file whose only mock call is doMock", () => {
    /** @scenario "A mock written with doMock is checked like any other" */
    it("reports its dead specifier rather than passing it over", () => {
      const sourceText = 'vi.doMock("./no/such/module", () => ({}));';

      const dead = scan(sourceText).filter(
        (site) =>
          resolveIn({
            specifier: site.specifier,
            fromDir: join(APP_ROOT, "src"),
            exists: [],
          }).kind === "missing",
      );

      expect(dead).toEqual([{ line: 1, specifier: "./no/such/module" }]);
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

  describe("given two aliases that both claim a specifier", () => {
    /** @scenario "Overlapping aliases keep the order the config declares" */
    it("takes the first one declared, the way vite does", () => {
      const throughFirst = "/mocks/at/generated/sdk.ts";

      expect(
        resolveIn({
          specifier: "@/generated/sdk",
          fromDir: APP_ROOT,
          exists: [throughFirst, "/mocks/generated/sdk.ts"],
          aliases: [
            { find: "@/", replacement: "/mocks/at/" },
            { find: "@/generated/", replacement: "/mocks/generated/" },
          ],
        }),
      ).toEqual({ kind: "resolved", file: throughFirst });
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
