import { describe, expect, it } from "vitest";
import {
  END_USER_SPEND_DESCRIPTION,
  SPEND_EVENTS_PULL_DESCRIPTION,
  SPEND_SUMMARIES_DESCRIPTION,
} from "../../transport/api-rest/gateway-spend.api";

describe("Feature: Gateway spend reconciliation REST surface", () => {
  describe("given the published route contract", () => {
    describe("when a caller reads it", () => {
      /** @scenario The response documents the retention window and dedup guidance */
      it("pins the retention window and dedup guidance in the route contract", () => {
        expect(SPEND_EVENTS_PULL_DESCRIPTION).toContain("13 months");
        expect(SPEND_EVENTS_PULL_DESCRIPTION).toContain("Metronome 34 days");
        expect(SPEND_EVENTS_PULL_DESCRIPTION).toContain("Stripe meters 24h+");
        // Named exactly, because the response field is `caps` and a substring
        // assertion on "cap" passed happily while the prose described a nullable
        // singular field the schema has never had.
        expect(END_USER_SPEND_DESCRIPTION).toContain("`caps`");
        expect(END_USER_SPEND_DESCRIPTION).toContain("empty array");
      });

      it("tells a caller how to page and when a grouping is refused", () => {
        // The refusal is the one thing a reconciliation script cannot discover by
        // trying: it only fires on recent windows, so a script written and tested
        // against last month's data meets it first in production.
        expect(SPEND_SUMMARIES_DESCRIPTION).toContain("gateway_spend_group_by_unstable");
        expect(SPEND_SUMMARIES_DESCRIPTION).toContain("allow_unstable");
        // Named exactly, because `key` keeping its single-dimension meaning is
        // what stops an existing consumer silently reading one of two dimensions.
        expect(SPEND_SUMMARIES_DESCRIPTION).toContain("`group`");
      });
    });
  });
});
