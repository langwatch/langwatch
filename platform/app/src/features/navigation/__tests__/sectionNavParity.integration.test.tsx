/**
 * @vitest-environment jsdom
 *
 * The Gateway and Governance layouts render their navigation from the
 * shared data in sectionNavItems. These tests pin the exact item lists
 * the legacy SectionNavigationLayout receives, so moving the items to
 * data changed nothing, and any future edit to the lists is a deliberate
 * one made in one place.
 */

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface CapturedItem {
  label: string;
  href: string;
  target?: string;
}
let capturedItems: CapturedItem[] = [];

const harness = vi.hoisted(() => ({
  /** Flags the useFeatureFlag mock reports enabled. */
  enabledFlags: [] as string[],
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled: harness.enabledFlags.includes(flag),
    isLoading: false,
  }),
}));

// useVisibleSectionNavItems resolves flags with org context; give it one.
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
  }),
}));

vi.mock("~/components/ui/layouts/SectionNavigationLayout", () => ({
  SectionNavigationLayout: ({
    navigationItems,
  }: {
    navigationItems: CapturedItem[];
  }) => {
    capturedItems = navigationItems;
    return null;
  },
}));

import AiGatewayLayout from "~/components/gateway/AiGatewayLayout";
import GovernanceLayout from "~/components/governance/GovernanceLayout";

describe("given the gateway section navigation data", () => {
  describe("when the gateway layout renders", () => {
    it("renders the pinned item list from the shared data", () => {
      render(<AiGatewayLayout>x</AiGatewayLayout>);

      expect(
        capturedItems.map((item) => ({
          label: item.label,
          href: item.href,
          target: item.target,
        })),
      ).toEqual([
        {
          label: "Virtual Keys",
          href: "/gateway/virtual-keys",
          target: undefined,
        },
        {
          label: "Model Providers",
          href: "/settings/model-providers",
          target: "_blank",
        },
        { label: "Budgets", href: "/gateway/budgets", target: undefined },
        {
          label: "Routing Policies",
          href: "/gateway/routing-policies",
          target: undefined,
        },
        {
          label: "Cache Rules",
          href: "/gateway/cache-rules",
          target: undefined,
        },
        { label: "Guardrails", href: "/gateway/guardrails", target: undefined },
        { label: "Usage", href: "/gateway/usage", target: undefined },
        {
          label: "Billing Events",
          href: "/gateway/billing-events",
          target: undefined,
        },
        { label: "Webhooks", href: "/gateway/webhooks", target: undefined },
      ]);
    });
  });
});

describe("given the governance section navigation data", () => {
  beforeEach(() => {
    harness.enabledFlags = [];
  });

  describe("when the governance layout renders with the billed-cost flag off", () => {
    /** @scenario With the billed-cost flag off, Costs and Billed do not exist */
    it("renders the pinned item list without Costs and Billed", () => {
      render(<GovernanceLayout>x</GovernanceLayout>);

      expect(
        capturedItems.map((item) => ({ label: item.label, href: item.href })),
      ).toEqual([
        { label: "Overview", href: "/governance" },
        { label: "Inventory", href: "/governance/inventory" },
        { label: "Anomaly Rules", href: "/governance/anomaly-rules" },
        { label: "People", href: "/governance/people" },
      ]);
    });
  });

  describe("when the governance layout renders with the billed-cost flag on", () => {
    /** @scenario With the billed-cost flag on, Costs and Billed appear as placeholders */
    it("lists Costs and Billed between Overview and Inventory", () => {
      harness.enabledFlags = ["release_ui_governance_billed_cost_enabled"];
      render(<GovernanceLayout>x</GovernanceLayout>);

      expect(
        capturedItems.map((item) => ({ label: item.label, href: item.href })),
      ).toEqual([
        { label: "Overview", href: "/governance" },
        { label: "Costs", href: "/governance/costs" },
        { label: "Billed", href: "/governance/billed" },
        { label: "Inventory", href: "/governance/inventory" },
        { label: "Anomaly Rules", href: "/governance/anomaly-rules" },
        { label: "People", href: "/governance/people" },
      ]);
    });
  });
});
