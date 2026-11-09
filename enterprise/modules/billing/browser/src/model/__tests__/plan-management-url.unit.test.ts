/**
 * Where the usage page's upgrade goes.
 * @see specs/licensing/seat-buying.feature
 */
import { describe, expect, it } from "vitest";

import { UPGRADE_DIALOG_HREF } from "../checkout-intent.ts";
import { planActionHref } from "../plan-management-url.ts";

describe("planActionHref()", () => {
  /** @scenario "The usage page upgrade leads to the seat dialog" */
  it("sends a Free cloud organization to the Growth seat dialog", () => {
    expect(planActionHref({ isSaaS: true, isFree: true, isEnterprise: false })).toBe(
      UPGRADE_DIALOG_HREF,
    );
    expect(UPGRADE_DIALOG_HREF).toBe("/settings/subscription?checkout=growth");
  });

  it("sends a paid cloud organization to the subscription page", () => {
    expect(planActionHref({ isSaaS: true, isFree: false, isEnterprise: false })).toBe(
      "/settings/subscription",
    );
  });

  it("sends a self-hosted install to the licence page", () => {
    expect(planActionHref({ isSaaS: false, isFree: true, isEnterprise: false })).not.toBe(
      UPGRADE_DIALOG_HREF,
    );
  });
});
