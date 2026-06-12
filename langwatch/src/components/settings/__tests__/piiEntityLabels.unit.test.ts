import { describe, expect, it } from "vitest";
import { PRESIDIO_STRICT_ENTITIES } from "../../../server/background/workers/collector/piiCheck";
import { ESSENTIAL_PII_ENTITIES } from "../../../server/data-privacy/redaction/essentialPii";
import {
  ESSENTIAL_PII_ENTITY_LABELS,
  STRICT_ADDED_PII_ENTITY_LABELS,
} from "../piiEntityLabels";

describe("PII entity tooltip labels", () => {
  describe("when the essential engine's entity list changes", () => {
    it("keeps the essential tooltip labels covering exactly the engine's entities", () => {
      expect(Object.keys(ESSENTIAL_PII_ENTITY_LABELS).sort()).toEqual(
        [...ESSENTIAL_PII_ENTITIES].sort(),
      );
    });
  });

  describe("when the strict analyzer's entity list changes", () => {
    it("keeps essential plus the strict additions covering exactly the analyzer's entities", () => {
      const labeled = [
        ...Object.keys(ESSENTIAL_PII_ENTITY_LABELS),
        ...Object.keys(STRICT_ADDED_PII_ENTITY_LABELS),
      ];
      expect(labeled.sort()).toEqual([...PRESIDIO_STRICT_ENTITIES].sort());
    });
  });
});
