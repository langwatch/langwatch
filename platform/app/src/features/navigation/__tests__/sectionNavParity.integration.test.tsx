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
  menuEnd?: unknown;
}
let capturedItems: CapturedItem[] = [];

const harness = vi.hoisted(() => ({
  /** Flags the useFeatureFlag mock reports enabled. */
  enabledFlags: [] as string[],
  /** Options each useFeatureFlag call received, keyed by flag name. */
  flagCallOptions: {} as Record<string, unknown>,
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string, options?: unknown) => {
    harness.flagCallOptions[flag] = options;
    return {
      enabled: harness.enabledFlags.includes(flag),
      isLoading: false,
    };
  },
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
import { NOT_TARGETED } from "~/server/featureFlag/targeting";

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

    it("does not resolve the billed-cost flag, which no gateway entry uses", () => {
      harness.flagCallOptions = {};
      render(<AiGatewayLayout>x</AiGatewayLayout>);

      // useVisibleSectionNavItems must call the hook unconditionally (hook
      // rules), but gatewayNavItems carries no flagged entry, so the query
      // is disabled rather than round-tripping for a result never read.
      expect(
        harness.flagCallOptions.release_ui_governance_billed_cost_enabled,
      ).toEqual({
        projectId: NOT_TARGETED,
        organizationId: "org-1",
        enabled: false,
      });
    });
  });
});

describe("given the governance section navigation data", () => {
  beforeEach(() => {
    harness.enabledFlags = [];
    harness.flagCallOptions = {};
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

      // The flag must resolve in organization context, gated on the org
      // being loaded — flags resolved without it silently read as off. The
      // layout holds no project, and says so.
      expect(
        harness.flagCallOptions.release_ui_governance_billed_cost_enabled,
      ).toEqual({
        projectId: NOT_TARGETED,
        organizationId: "org-1",
        enabled: true,
      });
    });
  });
});
