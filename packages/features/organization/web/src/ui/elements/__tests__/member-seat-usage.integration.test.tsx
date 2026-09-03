/**
 * @vitest-environment jsdom
 *
 * The seat counts on the member list.
 *
 * An admin reconciling an organization down to its plan decides person by
 * person, and the two decisions available to them, moving somebody to a Lite
 * Member seat and disabling them, are each refused once the matching allowance
 * runs out. Reading the allowance off a refusal means learning it after picking
 * the person and clicking save, so both counts belong on the page where the
 * picking happens.
 *
 * Spec: specs/licensing/seat-reconciliation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockUsageData } = vi.hoisted(() => ({
  mockUsageData: {
    current: null as { membersCount: number; membersLiteCount: number } | null,
  },
}));

vi.mock("../../../behavior/organization-api", () => ({
  api: {
    limits: {
      getUsage: {
        useQuery: () => ({ data: mockUsageData.current }),
      },
    },
  },
  organizationApi: {
    limits: {
      getUsage: {
        useQuery: () => ({ data: mockUsageData.current }),
      },
    },
  },
}));

import { MemberSeatUsage } from "../member-seat-usage";

const planWith = ({
  maxMembers,
  maxMembersLite,
}: {
  maxMembers: number;
  maxMembersLite: number;
}) => ({ maxMembers, maxMembersLite }) as any;

const renderSeatUsage = (plan: { maxMembers: number; maxMembersLite: number }) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <MemberSeatUsage organizationId="org_1" activePlan={planWith(plan)} />
    </ChakraProvider>,
  );

describe("given an organization with a seat allowance of each kind", () => {
  afterEach(() => {
    cleanup();
    mockUsageData.current = null;
  });

  describe("when an admin opens the member list", () => {
    /** @scenario The member list shows how many seats of each kind are in use */
    it("shows the full member seats in use against what the plan covers", () => {
      mockUsageData.current = { membersCount: 12, membersLiteCount: 1 };

      renderSeatUsage({ maxMembers: 15, maxMembersLite: 3 });

      expect(screen.getByText("Team Members")).toBeInTheDocument();
      expect(screen.getByText("12")).toBeInTheDocument();
      expect(screen.getByText("/ 15")).toBeInTheDocument();
    });

    /** @scenario The member list shows how many seats of each kind are in use */
    it("shows the Lite Member seats the same way", () => {
      mockUsageData.current = { membersCount: 12, membersLiteCount: 1 };

      renderSeatUsage({ maxMembers: 15, maxMembersLite: 3 });

      expect(screen.getByText("Lite Members")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("/ 3")).toBeInTheDocument();
    });

    /** @scenario The member list shows how many seats of each kind are in use */
    it("says unlimited rather than a number nobody can read", () => {
      // Self-hosted with no license resolves to MAX_SAFE_INTEGER, and printing
      // 9,007,199,254,740,991 seats would be worse than saying nothing.
      mockUsageData.current = { membersCount: 40, membersLiteCount: 0 };

      renderSeatUsage({
        maxMembers: Number.MAX_SAFE_INTEGER,
        maxMembersLite: Number.MAX_SAFE_INTEGER,
      });

      expect(screen.getAllByText("/ Unlimited").length).toBe(2);
    });
  });

  describe("when the counts have not arrived yet", () => {
    it("renders nothing rather than a zero it does not know", () => {
      const { container } = renderSeatUsage({
        maxMembers: 15,
        maxMembersLite: 3,
      });

      expect(container).toBeEmptyDOMElement();
    });
  });
});
