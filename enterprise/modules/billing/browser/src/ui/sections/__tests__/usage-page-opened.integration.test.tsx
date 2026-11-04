/**
 * @vitest-environment jsdom
 * Each billing screen a person reads their usage or plan on announces its own open.
 * @see enterprise/modules/nurturing/specs/app-opened.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlansScreen from "../plans.screen.tsx";
import SubscriptionScreen from "../subscription.screen.tsx";
import UsageScreen from "../usage.screen.tsx";

const recordPageOpened = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/auth-client", () => ({ useRecordPageOpened: recordPageOpened }));
vi.mock("../../../behavior/billing-api.ts", () => {
  const loading = { useQuery: () => ({ data: undefined, isLoading: true }) };
  return {
    billingApi: {
      plan: { getActivePlan: loading },
      limits: { getUsage: loading },
      license: { getStatus: loading },
    },
  };
});
vi.mock("../../../behavior/use-billing-pricing-service.ts", () => ({
  useBillingPricingService: () => ({ getGrowthSeatPriceCents: () => 0 }),
}));
vi.mock("../../../model/billing-host.ts", () => ({
  useBillingHost: () => ({
    organization: () => undefined,
    isDeploymentSettled: () => false,
    isSaaS: () => false,
  }),
}));

beforeEach(() => recordPageOpened.mockClear());
afterEach(() => cleanup());

describe("the billing screens", () => {
  /** @scenario "Each usage, cost or plan screen announces its open through the page-opened mutation" */
  it.each<[string, ComponentType, string]>([
    ["usage", UsageScreen, "settings_usage"],
    ["plans", PlansScreen, "settings_plans"],
    ["subscription", SubscriptionScreen, "settings_subscription"],
  ])("records the %s screen as opened", (_name, Screen, page) => {
    render(<Screen />, {
      wrapper: ({ children }) => (
        <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
      ),
    });

    expect(recordPageOpened.mock.calls).toEqual([[{ page }]]);
  });
});
