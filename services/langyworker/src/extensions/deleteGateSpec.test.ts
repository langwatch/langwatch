/**
 * Guards the spec itself (AC 23/24): the feature file must be bound (every
 * scenario tagged) and must carry the threat-model boundary sentence verbatim.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEATURE_PATH = join(
  __dirname,
  "../../../../specs/langy/langy-delete-gate.feature",
);

const BOUNDARY_SENTENCE =
  "This worker-side gate is defense-in-depth against accidental and " +
  "naively-injected deletes; it is not a guarantee against an adversarial " +
  "agent with repo write access, for which only a server-side confirmation " +
  "token at the credential boundary suffices.";

describe("delete-gate feature file", () => {
  const feature = readFileSync(FEATURE_PATH, "utf8");

  /** @scenario check-feature-parity reports this file's scenarios as bound, not vacuous */
  it("tags every scenario so check-feature-parity does not read it as vacuous", () => {
    const lines = feature.split("\n");
    const scenarioLines = lines.filter((line) => /^\s*Scenario( Outline)?:/.test(line));
    expect(scenarioLines.length).toBeGreaterThan(0);
    // Every Scenario/Scenario Outline is preceded by a binding tag
    // (@unit/@integration) — a tag on the line above, skipping blanks.
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^\s*Scenario( Outline)?:/.test(lines[i] ?? "")) continue;
      let j = i - 1;
      while (j >= 0 && (lines[j] ?? "").trim() === "") j -= 1;
      expect(lines[j] ?? "").toMatch(/@(unit|integration)/);
    }
  });

  it("carries the threat-model boundary sentence verbatim (AC 24)", () => {
    // The feature header wraps the sentence across lines; compare with wrapping
    // normalized to single spaces.
    const normalized = feature.replace(/#/g, " ").replace(/\s+/g, " ");
    expect(normalized).toContain(BOUNDARY_SENTENCE);
  });
});
