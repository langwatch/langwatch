/**
 * @vitest-environment jsdom
 * @see specs/licensing/billing-only-invite.feature
 * The plan reads ACTIVE subscription rows only, so the ops form warns when limits are typed
 * on a PENDING row.
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { SubscriptionStatus } from "../../../model/admin-enums.ts";
import { PendingLimitsNotice } from "../pending-limits-notice.tsx";

function renderNotice({ status, hasLimits }: { status: SubscriptionStatus; hasLimits: boolean }) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <PendingLimitsNotice status={status} hasLimits={hasLimits} />
    </DesignSystemProvider>,
  );
}

describe("<PendingLimitsNotice/>", () => {
  afterEach(cleanup);

  describe("given a PENDING subscription row with limits set", () => {
    /** @scenario "Staff are warned that limits on a PENDING row do nothing" */
    it("warns that the limits apply only once the row is ACTIVE", () => {
      renderNotice({ status: "PENDING", hasLimits: true });

      expect(screen.getByTestId("pending-limits-notice")).toHaveTextContent(
        /apply only once its status is ACTIVE/,
      );
    });
  });

  describe("given a PENDING row with no limits typed", () => {
    it("stays out of the way", () => {
      renderNotice({ status: "PENDING", hasLimits: false });

      expect(screen.queryByTestId("pending-limits-notice")).not.toBeInTheDocument();
    });
  });

  describe("given an ACTIVE row with limits set", () => {
    it("shows no warning", () => {
      renderNotice({ status: "ACTIVE", hasLimits: true });

      expect(screen.queryByTestId("pending-limits-notice")).not.toBeInTheDocument();
    });
  });
});
