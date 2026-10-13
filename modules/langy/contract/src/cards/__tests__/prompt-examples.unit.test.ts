/**
 * Tests that derived-card shapes in AGENTS.md match what the panel can render.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { DERIVED_SAFE_CARD_KINDS, langyDerivedCardSchema } from "../derived-safe.ts";

/**
 * Path lookup walks to workspace root (file move made counted ../ stale).
 */
function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("no workspace root above this test");
    dir = parent;
  }
  return dir;
}

const promptPath = path.join(repoRoot(), "services/langyagent/internal/assets/AGENTS.md");

/** The backticked `{"kind": …}` objects in the prompt's "Drawing data" bullets. */
function documentedCardExamples(prompt: string): string[] {
  return [...prompt.matchAll(/`(\{"kind":[\s\S]*?\})`/g)].map((m) => m[1]!);
}

describe("given the Langy prompt documents the derived-card shapes", () => {
  const prompt = fs.readFileSync(promptPath, "utf8");
  const examples = documentedCardExamples(prompt);

  describe("when each documented example is checked against the card contract", () => {
    /** @scenario The card shapes the prompt teaches are shapes the panel renders */
    it("finds one example per model-emittable kind", () => {
      const kinds = examples.map((raw) => JSON.parse(raw).kind);
      expect([...kinds].toSorted((a, b) => (a < b ? -1 : Number(a > b)))).toEqual(
        [...DERIVED_SAFE_CARD_KINDS].toSorted((a, b) => (a < b ? -1 : Number(a > b))),
      );
    });

    it.each(examples)("validates %s", (raw) => {
      const parsed = langyDerivedCardSchema.safeParse(JSON.parse(raw));
      expect(parsed.error?.issues ?? []).toEqual([]);
      expect(parsed.success).toBe(true);
    });
  });
});
