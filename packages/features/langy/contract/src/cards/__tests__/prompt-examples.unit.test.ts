/**
 * The derived-card shapes Langy's prompt documents must be shapes the panel can
 * actually render. The prompt is the only place the model learns this JSON, so
 * an example that fails the contract teaches every turn to emit a card that
 * degrades to the failed-card disclosure.
 *
 * This reads the shipped prompt rather than a copy of it, so the two cannot
 * drift: editing an example in AGENTS.md is what this test grades.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  DERIVED_SAFE_CARD_KINDS,
  langyDerivedCardSchema,
} from "../derived-safe";

const here = path.dirname(fileURLToPath(import.meta.url));
const promptPath = path.resolve(
  here,
  "../../../../../../services/langyagent/internal/assets/AGENTS.md",
);

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
      expect([...kinds].sort()).toEqual([...DERIVED_SAFE_CARD_KINDS].sort());
    });

    it.each(examples)("validates %s", (raw) => {
      const parsed = langyDerivedCardSchema.safeParse(JSON.parse(raw));
      expect(parsed.error?.issues ?? []).toEqual([]);
      expect(parsed.success).toBe(true);
    });
  });
});
