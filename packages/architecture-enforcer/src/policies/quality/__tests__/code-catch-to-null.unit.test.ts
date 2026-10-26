/**
 * Spec: specs/code-catch-to-null.feature.
 * Record: dev/docs/plans/platform-architecture-blocks.md rule 7d.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import {
  codeCatchToNullKey,
  collectCodeCatchToNull,
  lintCodeCatchToNull,
} from "../code-catch-to-null.ts";

let root = "";

const SERVICE = "modules/agent/process/src/services/agent.service.ts";
const TEST = "modules/agent/process/src/services/__tests__/agent.service.unit.test.ts";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-code-catch-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function snapshot({ code, path = SERVICE }: { code: string; path?: string }) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, code);

  return buildWorkspaceSnapshot({ root, changedFiles: [] });
}

function lines({ code, path }: { code: string; path?: string }): number[] {
  return collectCodeCatchToNull(snapshot({ code, path })).map((finding) => finding.line);
}

describe("code-catch-to-null", () => {
  describe("when a catch compares .code to a literal and answers null", () => {
    /** @scenario "A code-comparing catch that answers null is reported" */
    it("reports a catch clause, a catch chain and a ternary handler", () => {
      const code = [
        "async function a() {",
        "  try {",
        "    return await repo.getThing(id);",
        "  } catch (error) {",
        '    if (HandledError.isHandled(error) && error.code === "thing_not_found") return null;',
        "    throw error;",
        "  }",
        "}",
        "const b = await repo.getThing(id).catch((error) => {",
        '  if (error.code === "thing_not_found") {',
        "    return undefined;",
        "  }",
        "  throw error;",
        "});",
        'const c = await repo.getThing(id).catch((e) => (e.code === "gone" ? null : Promise.reject(e)));',
      ].join("\n");

      expect(lines({ code })).toEqual([5, 10, 15]);
    });
  });

  describe("when a catch asks XError.is of the caught error and answers null", () => {
    /** @scenario "A catch asking XError.is that answers null is reported" */
    it("reports it", () => {
      const code = [
        "try { x(); } catch (error) {",
        "  if (NotFoundError.is(error)) return null;",
        "  throw error;",
        "}",
      ].join("\n");

      expect(lines({ code })).toEqual([2]);
    });
  });

  describe("when the finding is linted", () => {
    /** @scenario "The report asks for the owner's find" */
    it("tells it to call the owner's find and read an empty list", () => {
      const [finding] = lintCodeCatchToNull(
        snapshot({
          code: 'try { x(); } catch (e) { if (e.code === "gone") return null; throw e; }',
        }),
      );

      expect(finding?.allowed).toContain("find*");
      expect(finding?.allowed).toContain("read []");
      expect(codeCatchToNullKey({ file: "a.ts", line: 1 })).toBe("a.ts");
    });
  });

  describe("when a catch does anything else", () => {
    /** @scenario "A catch that rethrows, maps or answers a value is accepted" */
    it("reports nothing", () => {
      const code = [
        "try { x(); } catch (e) {",
        '  if (e.code === "gone") return fallback;',
        "  throw e;",
        "}",
        "try { x(); } catch (e) {",
        "  if (e instanceof Gone) return null;",
        "  throw e;",
        "}",
        "try { x(); } catch (e) {",
        '  if (e.code === "gone") throw new Other();',
        "  return null;",
        "}",
        "try { x(); } catch (e) {",
        '  if (e.code === "gone") return;',
        "  throw e;",
        "}",
        "try { x(); } catch (e) {",
        "  if (NotFoundError.is(other)) return null;",
        "  throw e;",
        "}",
      ].join("\n");

      expect(lines({ code })).toEqual([]);
    });
  });

  describe("when the file is a test", () => {
    /** @scenario "A test file is left alone" */
    it("reports nothing", () => {
      const code = 'try { x(); } catch (e) { if (e.code === "gone") return null; throw e; }';

      expect(lines({ code, path: TEST })).toEqual([]);
    });
  });
});
