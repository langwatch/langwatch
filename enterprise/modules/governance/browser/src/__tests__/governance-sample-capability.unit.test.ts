/** @vitest-environment jsdom */
/**
 * Governance's sample-data choice, as a peer reaches it. The guided tour used
 * to import the writer out of governance; what it gets now is one capability
 * on the declaration, and the state stays where it is written.
 */
import { afterEach, describe, expect, it } from "vitest";

import { governanceWeb } from "../governance.web.ts";
import {
  readSampleChoice,
  subscribeToSampleChoice,
} from "../ui/elements/governance-sample-mode.ts";

const { setSampleChoice } = governanceWeb.installation.capabilities;

afterEach(() => {
  setSampleChoice(null);
});

describe("given a peer that wants governance's sample panels shown", () => {
  describe("when it sets the choice through the declared capability", () => {
    /** @scenario "The sample-data choice is offered as a capability, not an import" */
    it("shows them, puts them back, and forgets the choice when asked", () => {
      setSampleChoice(true);
      expect(readSampleChoice()).toBe(true);

      setSampleChoice(false);
      expect(readSampleChoice()).toBe(false);

      // Null is not "off": it returns each screen to its own default, which is
      // what the tour leaves behind for a reader who never chose.
      setSampleChoice(null);
      expect(readSampleChoice()).toBeNull();
    });

    /** @scenario "The sample-data choice is offered as a capability, not an import" */
    it("tells every toggle already on screen, so none of them reads as stale", () => {
      let heard = 0;
      const unsubscribe = subscribeToSampleChoice(() => {
        heard += 1;
      });

      setSampleChoice(true);
      unsubscribe();
      setSampleChoice(false);

      expect(heard).toBe(1);
    });
  });
});
