/**
 * The custom PII picker offers every identifier redaction can produce, once —
 * and offers it on the SIDE the engines actually detect it on.
 *
 * The original pin lived in
 * `platform/app/src/components/settings/__tests__/piiEntityLabels.unit.test.ts`
 * and read the two ENGINE lists, `ESSENTIAL_PII_ENTITIES` and
 * `PRESIDIO_STRICT_ENTITIES`. Both lived under `platform/app/src/server`, where
 * a browser package may not reach and which the migration ruling forbids
 * editing to publish them, so this file was rebuilt on
 * `REDACTION_MARKER_ENTITIES` alone and RECORDED the three assertions it lost:
 * that essential is exactly the native engine's list, that strict-added is
 * exactly the analyzer entities the native engine cannot detect, and that the
 * Brazilian CPF is the one native-only identifier.
 *
 * Those three are back. The two lists moved into `@langwatch/redaction` with
 * the trace-privacy harvest, into a dependency-free module the browser may
 * import — the engines that use them stay behind `@langwatch/redaction/pii`,
 * so this bundle still pulls in no recognizer table and no phone-number
 * library.
 *
 * What the picker depends on, in one line: an identifier with no checkbox can
 * never be turned off, an identifier with two is a duplicate row, and an
 * identifier under the wrong heading tells a customer the essential level
 * covers something only the strict level does.
 */

import {
  ESSENTIAL_PII_ENTITIES,
  REDACTION_MARKER_ENTITIES,
  SECRET_MARKER_ENTITY,
  STRICT_ONLY_PII_ENTITIES,
} from "@langwatch/redaction";
import { describe, expect, it } from "vitest";
import { ESSENTIAL_PII_ENTITY_LABELS, STRICT_ADDED_PII_ENTITY_LABELS } from "../pii-entity-labels";

const essential = Object.keys(ESSENTIAL_PII_ENTITY_LABELS);
const strictAdded = Object.keys(STRICT_ADDED_PII_ENTITY_LABELS);

/** Everything a redaction marker can name, minus the secrets marker. */
const redactableIdentities = [...REDACTION_MARKER_ENTITIES].filter(
  (entity) => entity !== SECRET_MARKER_ENTITY,
);

describe("given the two PII label maps the custom picker renders", () => {
  describe("when the redaction vocabulary changes", () => {
    it("labels every identity a redaction marker can name", () => {
      expect([...essential, ...strictAdded].sort()).toEqual([...redactableIdentities].sort());
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
      expect([...essential].sort()).toEqual([...ESSENTIAL_PII_ENTITIES].sort());
    });

    /** @scenario "The settings picker offers each identifier under the level that detects it" */
    it("labels as strict-added exactly what only the analysis service detects", () => {
      expect([...strictAdded].sort()).toEqual([...STRICT_ONLY_PII_ENTITIES].sort());
    });

    /** @scenario "The settings picker offers each identifier under the level that detects it" */
    it("keeps the Brazilian CPF on the essential side, as the one native-only identity", () => {
      expect(essential).toContain("BR_CPF");
      expect(strictAdded).not.toContain("BR_CPF");
    });
  });
});
