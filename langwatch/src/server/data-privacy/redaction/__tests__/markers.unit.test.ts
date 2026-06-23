import { describe, expect, it } from "vitest";
import { PRESIDIO_STRICT_ENTITIES } from "../../../background/workers/collector/piiCheck";
import { ESSENTIAL_PII_ENTITIES } from "../essentialPii";
import {
  findRedactionMarkers,
  formatPiiMarker,
  hasRedactionMarker,
  normalizePresidioMarkers,
  REDACTION_MARKER_ENTITIES,
  SECRET_MARKER_ENTITY,
} from "../markers";

describe("redaction markers", () => {
  describe("when the engine entity lists change", () => {
    it("covers exactly every engine entity (Presidio strict plus native-only) plus SECRET", () => {
      const expected = new Set([
        ...PRESIDIO_STRICT_ENTITIES,
        ...ESSENTIAL_PII_ENTITIES,
        SECRET_MARKER_ENTITY,
      ]);
      expect([...REDACTION_MARKER_ENTITIES].sort()).toEqual(
        [...expected].sort(),
      );
    });

    it("keeps the native essential set a subset of the markers (no native entity is unrenderable)", () => {
      for (const entity of ESSENTIAL_PII_ENTITIES) {
        expect(REDACTION_MARKER_ENTITIES.has(entity)).toBe(true);
      }
    });
  });

  describe("given text with typed markers", () => {
    it("counts markers grouped by entity across both bracket styles", () => {
      const markers = findRedactionMarkers(
        "call [PHONE_NUMBER] or [PHONE_NUMBER], email <EMAIL_ADDRESS>, key [SECRET]",
      );
      expect(markers.get("PHONE_NUMBER")).toBe(2);
      expect(markers.get("EMAIL_ADDRESS")).toBe(1);
      expect(markers.get("SECRET")).toBe(1);
    });

    it("ignores bracketed text that is not a known entity", () => {
      expect(
        findRedactionMarkers("[INFO] starting <html> [REDACTED]").size,
      ).toBe(0);
      expect(hasRedactionMarker("[INFO] nothing here")).toBe(false);
    });
  });

  describe("formatPiiMarker", () => {
    it("wraps an entity name in brackets", () => {
      expect(formatPiiMarker("PHONE_NUMBER")).toBe("[PHONE_NUMBER]");
    });
  });

  describe("normalizePresidioMarkers", () => {
    it("rewrites known angle-bracket markers to bracket markers", () => {
      expect(normalizePresidioMarkers("from <IP_ADDRESS> now")).toBe(
        "from [IP_ADDRESS] now",
      );
    });

    it("leaves unknown angle-bracket content untouched", () => {
      expect(normalizePresidioMarkers("a <div> and <PERSON>")).toBe(
        "a <div> and [PERSON]",
      );
    });
  });
});
