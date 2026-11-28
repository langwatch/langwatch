import { PRESIDIO_STRICT_ENTITIES } from "@langwatch/redaction";
import { describe, expect, it } from "vitest";

import { presidioDetectionBody } from "../presidio-exchange.rules.ts";

const settingsFor = (entities: readonly string[]) =>
  JSON.parse(presidioDetectionBody({ texts: ["hi"], entities })).settings;

describe("presidioDetectionBody", () => {
  describe("when a custom selection asks only for person names", () => {
    /** @scenario "The analysis request turns off every identifier the call did not ask for" */
    it("turns credit cards, emails and every other identifier off by name", () => {
      const { entities } = settingsFor(["PERSON"]);

      expect(entities.person).toBe(true);
      expect(entities.credit_card).toBe(false);
      expect(entities.email_address).toBe(false);
      expect(entities.phone_number).toBe(false);
      expect(Object.keys(entities).toSorted()).toEqual(
        PRESIDIO_STRICT_ENTITIES.map((name) => name.toLowerCase()).toSorted(),
      );
      expect(Object.values(entities).filter(Boolean)).toHaveLength(1);
    });
  });

  describe("when the call asks for every strict identifier", () => {
    /** @scenario "The analysis request turns off every identifier the call did not ask for" */
    it("turns every one of them on", () => {
      const { entities } = settingsFor(PRESIDIO_STRICT_ENTITIES);

      expect(Object.values(entities).every(Boolean)).toBe(true);
    });
  });
});
