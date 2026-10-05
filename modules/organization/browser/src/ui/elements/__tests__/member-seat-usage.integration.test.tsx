import { uiDeclarations, type UiResourceLimitRowProps } from "@langwatch/browser-host/declarations";
/**
 * @vitest-environment jsdom
 *
 * Seat counts on member list for per-person reconciliation decisions.
 * @see specs/licensing/seat-reconciliation.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The row is licensing's to draw; this suite checks what organization asks of it.
const LentRow = ({ limitType, label, current, max }: UiResourceLimitRowProps) => (
  <p>{`${limitType ?? label}: ${current} / ${max ?? "none"}`}</p>
);
vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () =>
    uiDeclarations([
      {
        name: "licensing",
        installation: {
          capabilities: { resourceLimitRow: { load: async () => ({ default: LentRow }) } },
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

const planWith = ({ maxMembers, maxMembersLite }: { maxMembers: number; maxMembersLite: number }) =>
  ({ maxMembers, maxMembersLite }) as any;

const renderSeatUsage = (plan: { maxMembers: number; maxMembersLite: number }) =>
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
  });

  describe("when the organization holds Developer seats", () => {
    /** @scenario Developers are counted and never capped */
    it("shows the Developer seats with no limit beside them", async () => {
      mockUsageData.current = { membersCount: 5, membersLiteCount: 5, membersDeveloperCount: 10 };

      renderSeatUsage({ maxMembers: 5, maxMembersLite: 5 });

      expect(await screen.findByText("Developers: 10 / none")).toBeInTheDocument();
      expect(screen.getByText("members: 5 / 5")).toBeInTheDocument();
      expect(screen.getByText("membersLite: 5 / 5")).toBeInTheDocument();
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
