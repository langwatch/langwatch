import { describe, expect, it } from "vitest";

import { isOptInSwitchOffered, optInOfferFor } from "../instant-eval-opt-in.rules.ts";

describe("isOptInSwitchOffered", () => {
  it.each([
    { isSaas: true, planType: "FREE", offered: true },
    { isSaas: true, planType: "PRO", offered: true },
    { isSaas: true, planType: "ENTERPRISE", offered: false },
    { isSaas: false, planType: "FREE", offered: false },
  ])("offers the switch on $planType when hosted is $isSaas: $offered", (row) => {
    expect(isOptInSwitchOffered({ isSaas: row.isSaas, planType: row.planType })).toBe(row.offered);
  });
});

describe("optInOfferFor", () => {
  it.each([
    { switchOffered: true, maySwitch: true, offer: "enable" },
    { switchOffered: true, maySwitch: false, offer: "ask_admin" },
    { switchOffered: false, maySwitch: true, offer: "contact_us" },
    { switchOffered: false, maySwitch: false, offer: "contact_us" },
  ] as const)(
    "offers $offer when offered is $switchOffered and the member may switch is $maySwitch",
    (row) => {
      expect(optInOfferFor({ switchOffered: row.switchOffered, maySwitch: row.maySwitch })).toBe(
        row.offer,
      );
    },
  );
});
