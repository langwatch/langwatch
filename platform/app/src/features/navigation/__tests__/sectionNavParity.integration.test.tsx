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
  menuEnd?: unknown;
}
let capturedItems: CapturedItem[] = [];

vi.mock("~/components/ui/layouts/SectionNavigationLayout", () => ({
  SectionNavigationLayout: ({ navigationItems }: { navigationItems: CapturedItem[] }) => {
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
        capturedItems.map((item) => ({ label: item.label, href: item.href })),
      ).toEqual([
        { label: "Virtual Keys", href: "/gateway/virtual-keys" },
        { label: "Model Providers", href: "/settings/model-providers" },
        { label: "Budgets", href: "/gateway/budgets" },
        { label: "Routing Policies", href: "/gateway/routing-policies" },
        { label: "Cache Rules", href: "/gateway/cache-rules" },
        { label: "Guardrails", href: "/gateway/guardrails" },
        { label: "Usage", href: "/gateway/usage" },
        { label: "Billing Events", href: "/gateway/billing-events" },
        { label: "Webhooks", href: "/gateway/webhooks" },
      ]);
    });

    /** @scenario "Every gateway entry opens in the tab the reader is in" */
    it("opens every entry in the same tab, with no new-tab marker", () => {
      render(<AiGatewayLayout>x</AiGatewayLayout>);

      expect(
        capturedItems.filter(
          (item) => item.target !== undefined || item.menuEnd !== undefined,
        ),
      ).toEqual([]);
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
        { label: "Catalog", href: "/governance/ingestion-sources" },
        { label: "Anomaly Rules", href: "/governance/anomaly-rules" },
        { label: "Tool Tiles", href: "/governance/tool-catalog" },
        { label: "Departments", href: "/governance/departments" },
      ]);
    });
  });
});
