/**
 * The overage maximum on the license form: no default on the registry, a
 * suggestion on the form when the switch is turned on.
 *
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */

import { describe, expect, it } from "vitest";
import {
  suggestedOverageMax,
  termsFormFrom,
  termsPayload,
  withOverageEnabled,
} from "../terms";

describe("given a license form with a commit and overage off", () => {
  describe("when the operator switches overage on", () => {
    /** @scenario Switching overage on suggests a quarter of the commit as the maximum */
    it("prefills the maximum with a quarter of the commit, editable", () => {
      const form = { ...termsFormFrom(null), commit: "1000.00" };

      const enabled = withOverageEnabled(form, true);

      expect(enabled.overageEnabled).toBe(true);
      expect(enabled.overageMax).toBe("250.00");
      expect(termsPayload(enabled).overageMaxUsdCents).toBe(25_000);
    });

    it("keeps a maximum the operator already typed", () => {
      const form = {
        ...termsFormFrom(null),
        commit: "1000.00",
        overageMax: "400.00",
      };

      expect(withOverageEnabled(form, true).overageMax).toBe("400.00");
    });

    it("suggests nothing when there is no commit to take a share of", () => {
      expect(suggestedOverageMax("")).toBe("");
      expect(suggestedOverageMax("0")).toBe("");
    });
  });

  describe("when the operator switches overage off again", () => {
    it("sends no maximum, whatever the field still reads", () => {
      const form = {
        ...termsFormFrom(null),
        commit: "1000.00",
        overageMax: "250.00",
      };

      const disabled = withOverageEnabled(form, false);

      expect(disabled.overageEnabled).toBe(false);
      expect(termsPayload(disabled).overageMaxUsdCents).toBeNull();
    });
  });
});
