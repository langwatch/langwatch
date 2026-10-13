import { DispatchError } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { AutomationDispatchErrorsService } from "../automation-dispatch-errors.service.ts";

const errors = AutomationDispatchErrorsService.create();

describe("AutomationDispatchErrorsService", () => {
  describe("given a delivery that failed for a reason a retry can fix", () => {
    /** @scenario "A graph alert whose delivery fails retryably is sent again on the retry" */
    it("is not terminal, so the alert's open claim is rolled back for the retry", () => {
      const refused = new DispatchError({
        message: 'Webhook for trigger "t": HTTP request failed — Connection refused',
        retryable: true,
      });

      expect(errors.isTerminal(refused)).toBe(false);
      expect(errors.isTerminal(new Error("unknown failure"))).toBe(false);
    });
  });

  describe("given a delivery no retry can fix", () => {
    it("is terminal, and a terminal error it creates reads as terminal", () => {
      expect(
        errors.isTerminal(new DispatchError({ message: "fence refused", retryable: false })),
      ).toBe(true);
      expect(errors.isTerminal(errors.createTerminal("no usable Slack connection"))).toBe(true);
    });
  });
});
