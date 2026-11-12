import { describe, expect, it } from "vitest";

import {
  mapLicenseStatusToLimits,
  mapUsageToLimits,
  type ResourceLimits,
} from "../resource-limits-display.tsx";

describe("mapLicenseStatusToLimits", () => {
  it("maps a license's counts to each resource's current use", () => {
    expect(
      mapLicenseStatusToLimits({
        currentMembers: 5,
        currentMembersLite: 2,
        currentMessagesPerMonth: 1500,
      }),
    ).toEqual({
      members: { current: 5 },
      membersLite: { current: 2 },
      messagesPerMonth: { current: 1500 },
    } satisfies ResourceLimits);
  });
});

describe("mapUsageToLimits", () => {
  it("maps usage counts to each resource's current use", () => {
    expect(
      mapUsageToLimits({ membersCount: 15, membersLiteCount: 20, currentMonthMessagesCount: 1500 }),
    ).toEqual({
      members: { current: 15 },
      membersLite: { current: 20 },
      messagesPerMonth: { current: 1500 },
    } satisfies ResourceLimits);
  });

  it("reads an unknown month count as zero", () => {
    expect(
      mapUsageToLimits({ membersCount: 0, membersLiteCount: 0, currentMonthMessagesCount: null })
        .messagesPerMonth.current,
    ).toBe(0);
  });
});
