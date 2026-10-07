/**
 * Spec: specs/prisma-relations.feature. Ruling: no new `@relation` (Alex, 2026-10-06); today's
 * lines are a shrink-only list (dev/docs/ARCHITECTURE.md §17).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(here, "..", "..", "prisma-client", "prisma", "schema.prisma");
const RELATIONS = join(here, "baselines", "prisma-relations.json");

/** The model of each `@relation` line, once per line; `//` comments are not read. */
function relationModels({ schema }: { schema: string }): string[] {
  let model = "";
  return schema.split("\n").flatMap((line) => {
    const code = line.split("//")[0] ?? "";
    const opened = /^\s*model\s+(\w+)/.exec(code);
    if (opened) model = opened[1]!;
    return /@relation\b/.test(code) ? [model] : [];
  });
}

function relations() {
  return compareRatchet({
    current: countByKey(relationModels({ schema: readFileSync(SCHEMA, "utf8") })),
    listed: readRatchet({ file: RELATIONS }).findings,
  });
}

describe("the Prisma relation list", () => {
  describe("given a schema", () => {
    /** @scenario "A @relation is counted against the model that declares it" */
    it("counts each model's lines and skips a commented-out one", () => {
      const schema = [
        "model A {",
        "  b   B   @relation(fields: [bId], references: [id])",
        "  c   C   @relation(fields: [cId], references: [id])",
        "  // d D @relation(fields: [dId], references: [id])",
        "}",
        "model B {",
        '  a A[] @relation("named")',
        "}",
      ].join("\n");
      expect(relationModels({ schema })).toEqual(["A", "A", "B"]);
    });
  });

  describe("when the tree's schema.prisma is read", () => {
    /** @scenario "No model gains a @relation" */
    it("finds no model above its listed count", () => {
      expect(
        relations().grown,
        "keep the reference a plain column with an index; see the postgres-migration skill",
      ).toEqual([]);
    });

    /** @scenario "A removed @relation lowers the list in the same change" */
    it("finds every listed count still reached", () => {
      expect(relations().stale, "lower these in tests/baselines/prisma-relations.json").toEqual([]);
    });
  });
});
