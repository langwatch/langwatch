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
import { describe, expect, it, vi } from "vitest";

interface CapturedItem {
  label: string;
  href: string;
  target?: string;
}
let capturedItems: CapturedItem[] = [];

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
  describe("when the governance layout renders", () => {
    it("renders the pinned item list from the shared data", () => {
      render(<GovernanceLayout>x</GovernanceLayout>);

      expect(
        capturedItems.map((item) => ({ label: item.label, href: item.href })),
      ).toEqual([
        { label: "Overview", href: "/governance" },
        { label: "Catalog", href: "/governance/catalog" },
        { label: "Anomaly Rules", href: "/governance/anomaly-rules" },
        { label: "Tool Tiles", href: "/governance/tool-catalog" },
        { label: "Departments", href: "/governance/departments" },
      ]);
    });
  });
});
