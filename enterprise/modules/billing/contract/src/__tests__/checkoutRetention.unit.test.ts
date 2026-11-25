/** @see specs/billing/retention-at-upgrade.feature */
import { organizationApiSeatCheckoutInputSchema } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { subscriptionTrpc } from "../subscription.trpc.ts";

const createInput = subscriptionTrpc.members.create.input;

const subscriptionCheckout = (retentionDays: number) => ({
  organizationId: "org_1",
  baseUrl: "https://app.example.com",
  plan: "GROWTH_SEAT_EUR_MONTHLY",
  retentionDays,
});

const seatCheckout = (retentionDays: number) => ({
  organizationId: "org_1",
  baseUrl: "https://app.example.com",
  totalSeats: 2,
  retentionDays,
  invites: [],
});

describe("Growth checkout retention", () => {
  /** @scenario "A retention value outside the Growth options is refused at checkout" */
  it("refuses an off-menu retention on both checkout inputs and accepts a Growth option", () => {
    expect(createInput.validate(subscriptionCheckout(100))).toBe(false);
    expect(organizationApiSeatCheckoutInputSchema.validate(seatCheckout(100))).toBe(false);

    expect(createInput.validate(subscriptionCheckout(182))).toBe(true);
    expect(organizationApiSeatCheckoutInputSchema.validate(seatCheckout(182))).toBe(true);
  });
});
