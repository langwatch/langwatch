/** A seat change that waited out the organization's seat lock is a handled, retryable conflict. */
import { explainAnyError } from "@langwatch/handled-error/presentation";
import { describe, expect, it } from "vitest";

import { SeatChangeBusyError } from "../organization-membership.errors.ts";

describe("SeatChangeBusyError", () => {
  describe("when another seat change holds the lock for the whole wait", () => {
    /** @scenario "A seat change that waits too long for the seat lock asks to try again" */
    it("is a retryable 409 with a plain message the presentation registry knows", () => {
      const error = new SeatChangeBusyError();

      expect(error).toMatchObject({ code: "seat_change_busy", httpStatus: 409, retryable: true });
      expect(error.message).toBe("Another seat change is in progress. Try again in a moment.");
      expect(explainAnyError(error)).toMatchObject({
        title: "Another seat change is in progress",
        description: "Try again in a moment.",
        isRegistered: true,
      });
    });
  });
});
