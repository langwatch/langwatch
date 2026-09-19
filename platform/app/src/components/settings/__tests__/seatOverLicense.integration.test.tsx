/**
 * @vitest-environment jsdom
 *
 * What an admin is told when seats go over what the license covers.
 *
 * A connected install may fill seats past its licensed count, within the
 * allowance its lease carries, and those seats are invoiced at the next
 * quarterly true-up. Both places an admin can cause that, the member list and
 * the invitation, say so before the invoice does.
 *
 * Spec: specs/self-hosting/connected-services/license-sync.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlanInfo } from "../../../../ee/licensing/planInfo";

const { mockUsageData } = vi.hoisted(() => ({
  mockUsageData: {
    current: null as { membersCount: number; membersLiteCount: number } | null,
  },
}));

vi.mock("../../../utils/api", () => ({
  api: {
    limits: { getUsage: { useQuery: () => ({ data: mockUsageData.current }) } },
  },
}));

import { MemberSeatUsage } from "../MemberSeatUsage";
import { SeatOverLicenseNotice } from "../SeatOverLicenseNotice";

const LEASED_PLAN = {
  maxMembers: 55,
  licensedMembers: 50,
  seatOverageAllowance: 5,
  maxMembersLite: 10,
} as PlanInfo;

const OFFLINE_PLAN = { maxMembers: 50, maxMembersLite: 10 } as PlanInfo;

function renderSeatUsage(plan: PlanInfo) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemberSeatUsage organizationId="org_1" activePlan={plan} />
    </ChakraProvider>,
  );
}

function renderInviteNotice(plan: PlanInfo | undefined) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SeatOverLicenseNotice organizationId="org_1" activePlan={plan} />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  mockUsageData.current = null;
});

describe("given a lease and one seat filled over the license", () => {
  describe("when an admin opens the member list", () => {
    /** @scenario "Going over the licensed seats says that it will be billed" */
    it("shows the licensed count, the seats in use and what will be invoiced", () => {
      mockUsageData.current = { membersCount: 51, membersLiteCount: 0 };

      renderSeatUsage(LEASED_PLAN);

      expect(screen.getByTestId("seat-overage").textContent).toBe(
        "50 licensed, 51 in use, 1 seat to be invoiced at the next quarterly true-up.",
      );
    });
  });
});

describe("given a lease and every licensed seat in use", () => {
  describe("when an admin opens the member list", () => {
    it("says nothing yet, because no seat is over the license", () => {
      mockUsageData.current = { membersCount: 50, membersLiteCount: 0 };

      renderSeatUsage(LEASED_PLAN);

      expect(screen.queryByTestId("seat-overage")).toBeNull();
    });
  });

  describe("when an admin opens the invitation", () => {
    /** @scenario "Going over the licensed seats says that it will be billed" */
    it("says the seat is over the license and will be invoiced", () => {
      mockUsageData.current = { membersCount: 50, membersLiteCount: 0 };

      renderInviteNotice(LEASED_PLAN);

      expect(
        screen.getByTestId("seat-over-license-notice").textContent,
      ).toContain("invoiced at the next quarterly true-up");
    });
  });
});

describe("given a lease and seats to spare", () => {
  describe("when an admin opens the invitation", () => {
    it("says nothing", () => {
      mockUsageData.current = { membersCount: 12, membersLiteCount: 0 };

      renderInviteNotice(LEASED_PLAN);

      expect(screen.queryByTestId("seat-over-license-notice")).toBeNull();
    });
  });
});

describe("given an install with no lease", () => {
  describe("when every licensed seat is in use", () => {
    /** @scenario "An air-gapped install keeps the hard cap" */
    it("says nothing about invoicing, because no seat may go over", () => {
      mockUsageData.current = { membersCount: 50, membersLiteCount: 0 };

      renderSeatUsage(OFFLINE_PLAN);
      renderInviteNotice(OFFLINE_PLAN);

      expect(screen.queryByTestId("seat-overage")).toBeNull();
      expect(screen.queryByTestId("seat-over-license-notice")).toBeNull();
    });
  });
});
