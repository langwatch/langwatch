import { describe, expect, it } from "vitest";
import { ESSENTIAL_PII_ENTITIES } from "../../../server/data-privacy/redaction/essentialPii";
import {
  ESSENTIAL_PII_ENTITY_LABELS,
  STRICT_ADDED_PII_ENTITY_LABELS,
} from "../piiEntityLabels";

/**
 * The strict level runs the Presidio analyzer; this is its entity list as
 * configured on the analysis path (piiCheck.ts). Imported lazily inside the
 * test to keep this suite's module graph slim.
 */
async function strictEntities(): Promise<string[]> {
  const { PRESIDIO_STRICT_ENTITIES } = await import(
    "../../../server/background/workers/collector/piiCheck"
  );
  return [...PRESIDIO_STRICT_ENTITIES];
}

describe("PII entity tooltip labels", () => {
  describe("when the essential engine's entity list changes", () => {
    it("keeps the essential tooltip labels covering exactly the engine's entities", () => {
      expect(Object.keys(ESSENTIAL_PII_ENTITY_LABELS).sort()).toEqual(
        [...ESSENTIAL_PII_ENTITIES].sort(),
      );
    });
  });

  describe("when the strict analyzer's entity list changes", () => {
    it("keeps essential plus the strict additions covering exactly the analyzer's entities", async () => {
      const strict = await strictEntities();
      const labeled = [
        ...Object.keys(ESSENTIAL_PII_ENTITY_LABELS),
        ...Object.keys(STRICT_ADDED_PII_ENTITY_LABELS),
      ];
      expect(labeled.sort()).toEqual([...strict].sort());
    });
  });
});
