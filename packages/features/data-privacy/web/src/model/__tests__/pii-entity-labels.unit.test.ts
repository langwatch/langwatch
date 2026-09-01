/**
 * The custom PII picker offers every identifier redaction can produce, once.
 *
 * `platform/app/src/components/settings/__tests__/piiEntityLabels.unit.test.ts`
 * pinned these two maps against the ENGINE lists — `ESSENTIAL_PII_ENTITIES` and
 * `PRESIDIO_STRICT_ENTITIES` — both of which live in `platform/app/src/server`,
 * where a browser package may not reach and which the migration ruling forbids
 * editing to publish them. So the pin is rebuilt on the portable vocabulary
 * instead: `@langwatch/redaction`'s `REDACTION_MARKER_ENTITIES` is the set of
 * entities a redaction marker can ever name, and it is the union of the strict
 * analyzer's list with the one native-only identifier.
 *
 * WHAT THAT KEEPS is the property the picker actually depends on — an entity
 * with no checkbox can never be turned off, and an entity with two is a
 * duplicate row — and it keeps it more completely than the original, which
 * checked coverage of the analyzer list alone.
 *
 * WHAT IT LOSES, recorded rather than hidden: the two assertions that pinned
 * WHICH SIDE of the split each entity falls on (essential is exactly the native
 * engine's list; strict-added is exactly the analyzer entities the native
 * engine cannot detect), and the one that named the Brazilian CPF as the
 * native-only case. Those need the two engine lists and return when they move
 * into `@langwatch/redaction`.
 */

import { REDACTION_MARKER_ENTITIES, SECRET_MARKER_ENTITY } from "@langwatch/redaction";
import { describe, expect, it } from "vitest";
import {
  ESSENTIAL_PII_ENTITY_LABELS,
  STRICT_ADDED_PII_ENTITY_LABELS,
} from "../pii-entity-labels";

const essential = Object.keys(ESSENTIAL_PII_ENTITY_LABELS);
const strictAdded = Object.keys(STRICT_ADDED_PII_ENTITY_LABELS);

/** Everything a redaction marker can name, minus the secrets marker. */
const redactableIdentities = [...REDACTION_MARKER_ENTITIES].filter(
  (entity) => entity !== SECRET_MARKER_ENTITY,
);

describe("given the two PII label maps the custom picker renders", () => {
  describe("when the redaction vocabulary changes", () => {
    it("labels every identity a redaction marker can name", () => {
      expect([...essential, ...strictAdded].sort()).toEqual(
        [...redactableIdentities].sort(),
      );
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
  });
});
