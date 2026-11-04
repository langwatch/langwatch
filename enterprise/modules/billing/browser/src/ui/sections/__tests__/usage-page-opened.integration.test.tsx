/**
 * @vitest-environment jsdom
 * Each billing screen a person reads their usage or plan on announces its own open, on hosted only.
 * @see enterprise/modules/nurturing/specs/app-opened.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlansScreen from "../plans.screen.tsx";
import SubscriptionScreen from "../subscription.screen.tsx";
import UsageScreen from "../usage.screen.tsx";

const { recordPageOpened, deployment } = vi.hoisted(() => ({
  recordPageOpened: vi.fn(),
  deployment: { settled: true, saas: true },
}));

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
    isDeploymentSettled: () => deployment.settled,
    isSaaS: () => deployment.saas,
  }),
}));
vi.mock("../subscription-page.tsx", () => ({ SubscriptionPage: () => null }));

const SCREENS: [string, ComponentType, string][] = [
  ["usage", UsageScreen, "settings_usage"],
  ["plans", PlansScreen, "settings_plans"],
  ["subscription", SubscriptionScreen, "settings_subscription"],
];

const renderScreen = (Screen: ComponentType) =>
  render(<Screen />, {
    wrapper: ({ children }) => (
      <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
    ),
  });

beforeEach(() => {
  recordPageOpened.mockClear();
  deployment.settled = true;
  deployment.saas = true;
});
afterEach(() => cleanup());

describe("the billing screens", () => {
  /** @scenario "Each usage, cost or plan screen announces its open through the page-opened mutation" */
  it.each(SCREENS)("records the %s screen as opened", (_name, Screen, page) => {
    renderScreen(Screen);

    expect(recordPageOpened.mock.calls).toEqual([[{ page }]]);
  });

  /** @scenario "A billing screen announces nothing until the deployment is known to be hosted" */
  it.each(SCREENS)(
    "records nothing for a self-hosted visitor to the %s screen",
    (_name, Screen) => {
      deployment.saas = false;

      renderScreen(Screen);

      expect(recordPageOpened).not.toHaveBeenCalled();
    },
  );

  /** @scenario "A billing screen announces nothing until the deployment is known to be hosted" */
  it.each(SCREENS)(
    "records nothing on the %s screen before the deployment answers",
    (_name, Screen) => {
      deployment.settled = false;
      deployment.saas = true;

      renderScreen(Screen);

      expect(recordPageOpened).not.toHaveBeenCalled();
    },
  );
});
