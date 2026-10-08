/**
 * Spec: specs/navigation/chunk-load-retry.feature
 * @vitest-environment node
 */

import { parseAst } from "vite";
import { describe, expect, it } from "vitest";

import { IMPORT_CHUNK_BINDING, wrapDynamicImports, wrapsImportsIn } from "../chunk-import-retry";

const HELPER = "/repo/packages/browser-host/src/navigation.ts";
const wrap = (code: string) =>
  wrapDynamicImports({ code, program: parseAst(code), helperPath: HELPER });

describe("given a module of ours", () => {
  describe("when it has import() expressions", () => {
    /** @scenario "The build retries every import in our code where it is made" */
    it("wraps each one and imports the helper at the end", () => {
      const code = [
        'const a = () => import("./a.ts");',
        'const b = async () => ({ default: (await import("./b.ts")).Thing });',
      ].join("\n");

      expect(wrap(code)).toBe(
        [
          `const a = () => ${IMPORT_CHUNK_BINDING}(() => import("./a.ts"));`,
          `const b = async () => ({ default: (await ${IMPORT_CHUNK_BINDING}(() => import("./b.ts"))).Thing });`,
          `import { importChunk as ${IMPORT_CHUNK_BINDING} } from "${HELPER}";`,
          "",
        ].join("\n"),
      );
    });
  });

  describe("when it has none", () => {
    it("leaves it alone", () => {
      expect(wrap('import x from "./x.ts";\nexport default x;')).toBeNull();
    });
  });
});

describe("given where a module lives", () => {
  const repoRoot = "/repo";

  it("wraps our source and leaves dependencies and the retry helper alone", () => {
    expect(wrapsImportsIn({ id: "/repo/modules/auth/browser/src/auth.web.ts", repoRoot })).toBe(
      true,
    );
    expect(wrapsImportsIn({ id: "/repo/node_modules/shiki/dist/index.mjs", repoRoot })).toBe(false);
    expect(
      wrapsImportsIn({ id: "/repo/packages/browser-host/src/chunk-refetch.ts", repoRoot }),
    ).toBe(false);
    expect(wrapsImportsIn({ id: "/repo/apps/ui/src/styles.css", repoRoot })).toBe(false);
  });
});
