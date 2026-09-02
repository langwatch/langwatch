/**
 * The alias-table reader the mock-specifier check resolves against.
 *
 * Spec: specs/setup/test-mock-specifier-resolution.feature
 */
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { aliasesForFile, type ModuleAlias, parseVitestConfigAliases } from "../vitest-alias-table";

/** platform/app/, from src/test-utils/__tests__/. */
const APP_ROOT = resolve(__dirname, "../../..");

const parse = (sourceText: string) =>
  parseVitestConfigAliases({
    fileName: join(APP_ROOT, "vitest.config.ts"),
    sourceText,
    configDir: APP_ROOT,
  });

describe("reading a vitest config's alias table", () => {
  describe("given the object table the app's configs declare", () => {
    /** @scenario "The check reads the alias table from the vitest configs" */
    it("expands each entry against the config's own directory", () => {
      expect(
        parse(
          [
            "export default defineConfig({",
            "  resolve: {",
            "    alias: {",
            '      "~/": join(__dirname, "./src/"),',
            '      "@app/": join(__dirname, "./src/server/app-layer/"),',
            "    },",
            "  },",
            "});",
          ].join("\n"),
        ),
      ).toEqual([
        { find: "~/", replacement: join(APP_ROOT, "src/") },
        {
          find: "@app/",
          replacement: join(APP_ROOT, "src/server/app-layer/"),
        },
      ]);
    });
  });

  describe("given a path built with join rather than resolve", () => {
    /** @scenario "An alias path expands the way the config's own call does" */
    it("keeps the config's directory in front of an absolute segment", () => {
      expect(
        parse(
          [
            "export default defineConfig({",
            '  resolve: { alias: { "~/": join(__dirname, "/src") } },',
            "});",
          ].join("\n"),
        ),
      ).toEqual([{ find: "~/", replacement: join(APP_ROOT, "src") }]);
    });

    it("keeps a trailing separator without doubling it", () => {
      expect(
        parse(
          [
            "export default defineConfig({",
            '  resolve: { alias: { "~/": join(__dirname, "./src/") } },',
            "});",
          ].join("\n"),
        ),
      ).toEqual([{ find: "~/", replacement: `${join(APP_ROOT, "src")}/` }]);
    });
  });

  describe("given a path built with resolve rather than join", () => {
    /** @scenario "An alias path expands the way the config's own call does" */
    it("lets an absolute segment discard the config's directory", () => {
      expect(
        parse(
          [
            "export default defineConfig({",
            '  resolve: { alias: { "~/": resolve(__dirname, "/src") } },',
            "});",
          ].join("\n"),
        ),
      ).toEqual([{ find: "~/", replacement: "/src" }]);
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

    /** @scenario "Overlapping aliases keep the order the config declares" */
    it("keeps the declared order, which is what decides precedence", () => {
      expect(
        parse(
          [
            "export default defineConfig({",
            "  resolve: {",
            "    alias: [",
            '      { find: "@/", replacement: "/mocks/at/" },',
            '      { find: "@/generated/", replacement: "/mocks/generated/" },',
            "    ],",
            "  },",
            "});",
          ].join("\n"),
        ).map((entry) => entry.find),
      ).toEqual(["@/", "@/generated/"]);
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
          ["export default defineConfig({", "  resolve: { alias: sharedAliases },", "});"].join(
            "\n",
          ),
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

describe("choosing the table in force for a file", () => {
  const appTable: ModuleAlias[] = [{ find: "~/", replacement: join(APP_ROOT, "src/") }];
  const nestedTable: ModuleAlias[] = [{ find: "~", replacement: join(APP_ROOT, "e2e/src") }];
  const tables = new Map<string, ModuleAlias[]>([
    [APP_ROOT, appTable],
    [join(APP_ROOT, "e2e/code-agent"), nestedTable],
  ]);

  describe("given a file under a nested config", () => {
    it("takes the nearest config's table, not the app's", () => {
      expect(
        aliasesForFile({
          file: join(APP_ROOT, "e2e/code-agent/__tests__/a.test.ts"),
          aliasesByConfigDir: tables,
        }),
      ).toBe(nestedTable);
    });
  });

  describe("given a file with no nested config above it", () => {
    it("takes the app's table", () => {
      expect(
        aliasesForFile({
          file: join(APP_ROOT, "src/components/a.test.ts"),
          aliasesByConfigDir: tables,
        }),
      ).toBe(appTable);
    });
  });

  describe("given a file with no config above it at all", () => {
    it("has no aliases rather than borrowing someone else's", () => {
      expect(
        aliasesForFile({
          file: "/elsewhere/a.test.ts",
          aliasesByConfigDir: tables,
        }),
      ).toEqual([]);
    });
  });
});
