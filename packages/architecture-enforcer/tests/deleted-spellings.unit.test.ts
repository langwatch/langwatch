/**
 * Spec: specs/tooling/lint-deleted-spellings.feature. Record: dev/docs/ARCHITECTURE.md §15, §17.
 * Fixtures use invented spellings, so this file adds nothing to the tree's own counts.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  countDeletedSpellingsInCode,
  DELETED_SPELLINGS_LIST,
  DELETED_SPELLINGS_RATCHET,
  lintDeletedSpellingsInCode,
  lintDeletedSpellingsInTeaching,
  readDeletedSpellings,
} from "../src/policies/quality/deleted-spellings.ts";
import { MissingAnchorError } from "../src/workspace/anchors.ts";
import { buildWorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, readRatchet } from "./ratchet.ts";
import { snapshotOf } from "./workspace.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const LIST = {
  record: "fixture",
  listed: "2026-10-05",
  spellings: [
    {
      spelling: "oldThing",
      kind: "identifier",
      pattern: "\\boldThing\\b",
      replacement: "`newThing`",
      section: "§4",
      ruled: null,
    },
    {
      spelling: "`*.legacy.ts` files",
      kind: "file",
      path: "\\.legacy\\.ts$",
      pattern: "\\.legacy\\.ts\\b",
      replacement: "`<f>.module.ts`",
      section: "§16",
      ruled: "2026-10-01",
    },
    {
      spelling: "a bespoke shape",
      kind: "prose",
      replacement: "the container",
      section: "§5",
      ruled: null,
      note: "A shape, not a name.",
    },
  ],
};

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-deleted-spellings-"));
  write({ path: DELETED_SPELLINGS_LIST, content: JSON.stringify(LIST) });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write({ path, content }: { path: string; content: string }): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

function teachingFindings() {
  return lintDeletedSpellingsInTeaching(snapshotOf({ root }));
}

describe("deleted-spellings-in-teaching", () => {
  describe("when a skill teaches a deleted spelling", () => {
    /** @scenario "A teaching surface that names a deleted spelling is reported with its replacement" */
    it("reports the file, the line, the spelling and the replacement", () => {
      write({
        path: ".claude/skills/demo/SKILL.md",
        content: "# Demo\n\nStart with `oldThing()` here.\n",
      });

      const [finding, ...rest] = teachingFindings();

      expect(rest).toEqual([]);
      expect(finding).toMatchObject({
        policy: "deleted-spellings-in-teaching",
        file: ".claude/skills/demo/SKILL.md",
        line: 3,
        specifier: "oldThing",
      });
      expect(finding?.allowed).toContain("`newThing`");
    });
  });

  describe("when the spelling sits in a deletion note", () => {
    /** @scenario "A deletion note naming a deleted spelling passes" */
    it("passes the sentence, the deleted section, the framed list, table and code fence", () => {
      write({
        path: "CLAUDE.md",
        content: [
          "`oldThing` is deleted; write `newThing`. Use `newThing` in new code.",
          "",
          "Never write these:",
          "",
          "- `oldThing`",
          "- `x.legacy.ts`",
          "",
          "| Deleted | Write instead |",
          "| --- | --- |",
          "| `oldThing` | `newThing` |",
          "",
          "Wrong:",
          "",
          "```ts",
          "oldThing();",
          "```",
          "",
          "## Deleted spellings",
          "",
          "`oldThing` · `x.legacy.ts`",
        ].join("\n"),
      });

      expect(teachingFindings()).toEqual([]);
    });

    it("still reports a use in the sentence after the note", () => {
      write({
        path: "dev/docs/guide.md",
        content: "`oldThing` was removed. Then call `oldThing()` again.\n",
      });

      expect(teachingFindings().map((finding) => finding.line)).toEqual([1]);
    });
  });

  describe("when a decision record or a plan names the spelling", () => {
    /** @scenario "Architecture decision records and plans are not teaching surfaces" */
    it("reads neither", () => {
      write({ path: "dev/docs/adr/001-old.md", content: "We call `oldThing()`.\n" });
      write({ path: "dev/docs/plans/next.md", content: "We call `oldThing()`.\n" });

      expect(teachingFindings()).toEqual([]);
    });
  });
});

describe("deleted-spellings-in-code", () => {
  describe("when code uses a deleted spelling", () => {
    /** @scenario "Every use of a deleted spelling in code is reported with its replacement and record section" */
    it("reports each use by line and each deleted file kind by file", () => {
      write({
        path: "modules/demo/process/src/demo.service.ts",
        content: "export const a = 1;\noldThing();\n",
      });
      write({ path: "modules/demo/process/src/demo.legacy.ts", content: "export {};\n" });

      const findings = lintDeletedSpellingsInCode(snapshotOf({ root }));

      expect(findings.map(({ file, line, specifier }) => ({ file, line, specifier }))).toEqual([
        {
          file: "modules/demo/process/src/demo.legacy.ts",
          line: undefined,
          specifier: "`*.legacy.ts` files",
        },
        { file: "modules/demo/process/src/demo.service.ts", line: 2, specifier: "oldThing" },
      ]);
      expect(findings[1]?.message).toContain("§4");
      expect(findings[1]?.allowed).toContain("`newThing`");
    });
  });

  describe("when the use is generated or a deletion note", () => {
    /** @scenario "Generated code and a deletion note in code are not counted" */
    it("counts neither", () => {
      write({ path: "packages/demo/src/generated/client.ts", content: "oldThing();\n" });
      write({ path: "packages/demo/src/demo.generated.ts", content: "oldThing();\n" });
      write({
        path: "packages/demo/src/rule.ts",
        content: "// `oldThing` is deleted: write `newThing`.\n",
      });

      expect(lintDeletedSpellingsInCode(snapshotOf({ root }))).toEqual([]);
    });
  });

  describe("when a count is compared with the shrink-only list", () => {
    /** @scenario "A new use over the list is refused and a removal must lower it" */
    it("refuses a rise and asks for a fall to be written down", () => {
      write({ path: "apps/demo/src/a.ts", content: "oldThing();\noldThing();\n" });
      const current = countDeletedSpellingsInCode(snapshotOf({ root }));

      expect(compareRatchet({ current, listed: { oldThing: 1 } }).grown).toEqual([
        "oldThing: 2 found, 1 listed",
      ]);
      expect(compareRatchet({ current, listed: { oldThing: 3 } }).stale).toEqual([
        "oldThing: 2 found, 3 listed",
      ]);
    });
  });

  describe("when the list is missing", () => {
    /** @scenario "The deleted-spellings policies refuse to run without the list" */
    it("throws, naming the policy and the list", () => {
      rmSync(join(root, DELETED_SPELLINGS_LIST));

      expect(() => teachingFindings()).toThrow(MissingAnchorError);
      expect(() => lintDeletedSpellingsInCode(snapshotOf({ root }))).toThrow(
        DELETED_SPELLINGS_LIST,
      );
    });
  });
});

describe("the tree's deleted spellings", () => {
  describe("when the list beside the record is read", () => {
    /** @scenario "The list holds every spelling of §15 in a shape the guards can read" */
    it("parses, and every pattern compiles", () => {
      const spellings = readDeletedSpellings({
        root: REPO_ROOT,
        policy: "deleted-spellings-in-code",
      });

      for (const entry of spellings) {
        expect(() => new RegExp(entry.pattern ?? "", "g"), entry.spelling).not.toThrow();
        expect(() => new RegExp(entry.path ?? ""), entry.spelling).not.toThrow();
      }
      expect(new Set(spellings.map((entry) => entry.spelling)).size).toBe(spellings.length);
    });
  });

  describe("when code's counts are compared with the shrink-only list", () => {
    const ratchet = () =>
      compareRatchet({
        current: countDeletedSpellingsInCode(
          buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] }),
        ),
        listed: readRatchet({ file: join(REPO_ROOT, DELETED_SPELLINGS_RATCHET) }).findings,
      });

    /** @scenario "No deleted spelling's count in code rises above the shrink-only list" */
    it("finds no count above its listed one, and none below it", () => {
      const { grown, stale } = ratchet();

      expect(grown, "write the replacement the policy names instead (ARCHITECTURE.md §15)").toEqual(
        [],
      );
      expect(
        stale,
        "lower these: node --experimental-transform-types packages/architecture-enforcer/src/tools/deleted-spellings.ts --lower",
      ).toEqual([]);
    }, 60_000);
  });
});
