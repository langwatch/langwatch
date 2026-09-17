/**
 * Verifies the PII picker offers every identifier exactly once on the correct
 * engine side and that detection levels map correctly.
 */

import {
  ESSENTIAL_PII_ENTITIES,
  REDACTION_MARKER_ENTITIES,
  SECRET_MARKER_ENTITY,
  STRICT_ONLY_PII_ENTITIES,
} from "@langwatch/redaction";
import { describe, expect, it } from "vitest";
import { ESSENTIAL_PII_ENTITY_LABELS, STRICT_ADDED_PII_ENTITY_LABELS } from "../pii-entity-labels.ts";

const essential = Object.keys(ESSENTIAL_PII_ENTITY_LABELS);
const strictAdded = Object.keys(STRICT_ADDED_PII_ENTITY_LABELS);

/** Everything a redaction marker can name, minus the secrets marker. */
const redactableIdentities = [...REDACTION_MARKER_ENTITIES].filter(
  (entity) => entity !== SECRET_MARKER_ENTITY,
);

describe("given the two PII label maps the custom picker renders", () => {
  describe("when the redaction vocabulary changes", () => {
    it("labels every identity a redaction marker can name", () => {
      expect([...essential, ...strictAdded].toSorted()).toEqual([...redactableIdentities].toSorted());
    });

    it("never offers the secrets marker as a PII identity", () => {
      expect([...essential, ...strictAdded]).not.toContain(SECRET_MARKER_ENTITY);
    });
  });

  describe("when an identity moves between detection levels", () => {
    it("keeps the two groups disjoint, so no identity gets two checkboxes", () => {
      const both = essential.filter((entity) => strictAdded.includes(entity));
      expect(both).toEqual([]);
    });

    /** @scenario "The settings picker offers each identifier under the level that detects it" */
    it("labels as essential exactly what the native engine detects", () => {
      expect([...essential].toSorted()).toEqual([...ESSENTIAL_PII_ENTITIES].toSorted());
    });

    /** @scenario "The settings picker offers each identifier under the level that detects it" */
    it("labels as strict-added exactly what only the analysis service detects", () => {
      expect([...strictAdded].toSorted()).toEqual([...STRICT_ONLY_PII_ENTITIES].toSorted());
    });

    /** @scenario "The settings picker offers each identifier under the level that detects it" */
    it("keeps the Brazilian CPF on the essential side, as the one native-only identity", () => {
      expect(essential).toContain("BR_CPF");
      expect(strictAdded).not.toContain("BR_CPF");
    });
  });
});
