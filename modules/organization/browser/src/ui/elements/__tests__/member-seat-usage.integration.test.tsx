import { uiDeclarations } from "@langwatch/browser-host/declarations";
/**
 * @vitest-environment jsdom
 *
 * Seat counts on member list for per-person reconciliation decisions.
 * @see specs/licensing/seat-reconciliation.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import {
  ResourceLimitRowToken,
  type ResourceLimitRowProps,
} from "@langwatch/enterprise-licensing-client";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The row is licensing's to draw; this suite checks what organization asks of it.
const LentRow = ({ limitType, label, current, max }: ResourceLimitRowProps) => (
  <p>{`${limitType ?? label}: ${current} / ${max ?? "none"}`}</p>
);
vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () =>
    uiDeclarations([
      {
        name: "licensing",
        installation: {
          capabilities: {},
          lends: [{ token: ResourceLimitRowToken, load: async () => ({ default: LentRow }) }],
        },
      },
    ]),
}));

const { mockUsageData } = vi.hoisted(() => ({
  mockUsageData: {
    current: null as {
      membersCount: number;
      membersLiteCount: number;
      membersDeveloperCount: number;
    } | null,
  },
}));

vi.mock("../../../behavior/organization-api.ts", () => ({
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

import { MemberSeatUsage } from "../../sections/member-seat-usage.tsx";

type SeatPlan = {
  maxMembers: number;
  maxMembersLite: number;
  maxMembersDeveloper?: number;
  planSource?: "license" | "subscription" | "free";
};

const planWith = ({
  maxMembers,
  maxMembersLite,
  maxMembersDeveloper = 0,
  planSource = "subscription",
}: SeatPlan) => ({ maxMembers, maxMembersLite, maxMembersDeveloper, planSource }) as any;

const renderSeatUsage = (plan: SeatPlan) =>
  renderWithDesignSystem(<MemberSeatUsage organizationId="org_1" activePlan={planWith(plan)} />);

describe("given an organization with a seat allowance of each kind", () => {
  afterEach(() => {
    cleanup();
    mockUsageData.current = null;
  });

  describe("when an admin opens the member list", () => {
    /** @scenario The member list shows how many seats of each kind are in use */
    it("shows the full member seats in use against what the plan covers", async () => {
      mockUsageData.current = { membersCount: 12, membersLiteCount: 1, membersDeveloperCount: 0 };

      renderSeatUsage({ maxMembers: 15, maxMembersLite: 3 });

      expect(await screen.findByText("members: 12 / 15")).toBeInTheDocument();
    });

    /** @scenario The member list shows how many seats of each kind are in use */
    it("shows the Lite Member seats the same way", async () => {
      mockUsageData.current = { membersCount: 12, membersLiteCount: 1, membersDeveloperCount: 0 };

      renderSeatUsage({ maxMembers: 15, maxMembersLite: 3 });

      expect(await screen.findByText("membersLite: 1 / 3")).toBeInTheDocument();
    });

    /** @scenario The member list shows Developer seats against the Developer seats paid for */
    it("shows the Developer seats in use against the plan's Developer cap", async () => {
      mockUsageData.current = { membersCount: 5, membersLiteCount: 5, membersDeveloperCount: 3 };

      renderSeatUsage({ maxMembers: 5, maxMembersLite: 5, maxMembersDeveloper: 4 });

      expect(await screen.findByText("Developers: 3 / 4")).toBeInTheDocument();
    });
  });

  describe("when the plan has no Lite Member seats", () => {
    /** @scenario A plan without Lite Member seats shows no Lite card on the member list */
    it("shows no Lite card rather than zero of zero", async () => {
      mockUsageData.current = { membersCount: 2, membersLiteCount: 0, membersDeveloperCount: 0 };

      renderSeatUsage({ maxMembers: 2, maxMembersLite: 0 });

      expect(await screen.findByText("members: 2 / 2")).toBeInTheDocument();
      expect(screen.queryByText(/membersLite/)).toBeNull();
    });

    it("still shows Lite Members someone holds over the plan", async () => {
      mockUsageData.current = { membersCount: 2, membersLiteCount: 1, membersDeveloperCount: 0 };

      renderSeatUsage({ maxMembers: 2, maxMembersLite: 0 });

      expect(await screen.findByText("membersLite: 1 / 0")).toBeInTheDocument();
    });
  });

  describe("when the plan allows as many Lite Member seats as the organization wants", () => {
    /** @scenario Uncapped Lite Member seats read as Unlimited on the member list */
    it("shows the Lite Member seats in use against an unlimited cap, not 9,999", async () => {
      mockUsageData.current = { membersCount: 3, membersLiteCount: 4, membersDeveloperCount: 0 };

      renderSeatUsage({ maxMembers: 3, maxMembersLite: 9_999 });

      expect(await screen.findByText("membersLite: 4 / Infinity")).toBeInTheDocument();
      expect(screen.queryByText(/9999/)).toBeNull();
    });

    it("keeps a real Lite cap as the number it is", async () => {
      mockUsageData.current = { membersCount: 3, membersLiteCount: 4, membersDeveloperCount: 0 };

      renderSeatUsage({ maxMembers: 3, maxMembersLite: 9_998 });

      expect(await screen.findByText("membersLite: 4 / 9998")).toBeInTheDocument();
    });

    it("keeps a finite licence cap above the stand-in as the number it is", async () => {
      mockUsageData.current = { membersCount: 3, membersLiteCount: 4, membersDeveloperCount: 0 };

      renderSeatUsage({ maxMembers: 10_000, maxMembersLite: 9_999 });

      expect(await screen.findByText("members: 3 / 10000")).toBeInTheDocument();
      expect(screen.getByText("membersLite: 4 / Infinity")).toBeInTheDocument();
    });

    it("keeps a licence's 9,999 as a real cap", async () => {
      mockUsageData.current = { membersCount: 3, membersLiteCount: 4, membersDeveloperCount: 0 };

      renderSeatUsage({ maxMembers: 9_999, maxMembersLite: 9_999, planSource: "license" });

      expect(await screen.findByText("members: 3 / 9999")).toBeInTheDocument();
      expect(screen.getByText("membersLite: 4 / 9999")).toBeInTheDocument();
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
