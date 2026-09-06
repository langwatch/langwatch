import { describe, expect, it } from "vitest";
import { ESSENTIAL_PII_ENTITIES } from "../../../server/data-privacy/redaction/essentialPii";
import { PRESIDIO_STRICT_ENTITIES } from "../../../server/tracer/collector/piiCheck";
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
    it("labels the strict additions as exactly the analyzer entities the native engine cannot detect", () => {
      const native = new Set<string>(ESSENTIAL_PII_ENTITIES);
      const strictOnly = PRESIDIO_STRICT_ENTITIES.filter(
        (entity) => !native.has(entity),
      );
      expect(Object.keys(STRICT_ADDED_PII_ENTITY_LABELS).sort()).toEqual(
        [...strictOnly].sort(),
      );
    });

    it("covers every analyzer entity with a label (native ones via essential, the rest via the additions)", () => {
      const labeled = new Set([
        ...Object.keys(ESSENTIAL_PII_ENTITY_LABELS),
        ...Object.keys(STRICT_ADDED_PII_ENTITY_LABELS),
      ]);
      for (const entity of PRESIDIO_STRICT_ENTITIES) {
        expect(labeled.has(entity)).toBe(true);
      }
    });
  });

  describe("when a native-only identifier has no analyzer equivalent", () => {
    it("keeps the Brazilian CPF native-only (the strict analyzer does not detect it, the native floor does)", () => {
      expect([...ESSENTIAL_PII_ENTITIES]).toContain("BR_CPF");
      expect([...PRESIDIO_STRICT_ENTITIES]).not.toContain("BR_CPF");
    });
  });
});
