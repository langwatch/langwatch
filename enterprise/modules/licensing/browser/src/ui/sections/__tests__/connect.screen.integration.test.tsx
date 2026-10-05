/**
 * @vitest-environment jsdom
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { ConnectStatus } from "@langwatch/enterprise-licensing-contract";
import { cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LicensingHostApi,
  LicensingHostProvider,
  type LicensingFailureNotice,
} from "../../../model/licensing-host.ts";
import ConnectScreen from "../connect.screen.tsx";

const answer: { status: ConnectStatus | undefined } = { status: undefined };
const mutation = { mutate: vi.fn(), isPending: false };

vi.mock("../../../behavior/connect-api.ts", () => ({
  connectApi: {
    connect: {
      status: {
        useQuery: () => ({ isLoading: false, error: null, data: answer.status, refetch: vi.fn() }),
      },
      setService: { useMutation: () => mutation },
      setCap: { useMutation: () => mutation },
    },
  },
}));

class TestHost extends LicensingHostApi {
  constructor(private readonly admin: boolean) {
    super();
  }
  organizationId() {
    return "org-1";
  }
  isSaaS() {
    return false;
  }
  isDeploymentSettled() {
    return true;
  }
  licensePurchaseUrl() {
    return undefined;
  }
  refreshPlanDerivedState() {}
  succeeded() {}
  failed() {}
  canManageOrganization() {
    return this.admin;
  }
  describeFailure(failure: LicensingFailureNotice) {
    return failure.fallbackTitle;
  }
}

function connected(overrides: Partial<Extract<ConnectStatus, { deployment: "on" }>> = {}) {
  return {
    deployment: "on",
    gatewayHost: "gateway.langwatch.ai",
    licensed: true,
    enabledServices: ["instant_evals"],
    entitledServices: ["instant_evals"],
    usage: null,
    refusal: null,
    isUsageUnavailable: false,
    sync: { lastSyncAt: null, lastError: null },
    ...overrides,
  } satisfies ConnectStatus;
}

function renderScreen({ status, admin = true }: { status: ConnectStatus; admin?: boolean }) {
  answer.status = status;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <LicensingHostProvider value={new TestHost(admin)}>{children}</LicensingHostProvider>
  );
  renderWithDesignSystem(
    <Wrapper>
      <ConnectScreen />
    </Wrapper>,
  );
}

function switchOf(service: string): HTMLInputElement {
  const input = screen.getByTestId(`connect-service-switch-${service}`);
  if (!(input instanceof HTMLInputElement)) throw new Error("the switch is not an input");
  return input;
}

afterEach(cleanup);

describe("ConnectScreen", () => {
  describe("given a licensed install with Connect on", () => {
    /** @scenario "A service the license names is on without anyone switching it on" */
    it("shows the entitled service switched on", () => {
      renderScreen({ status: connected() });
      expect(switchOf("instant_evals").checked).toBe(true);
    });

    /** @scenario "The page states what leaves the install for each service" */
    it("states what each service sends before the switch is touched", () => {
      renderScreen({ status: connected() });
      expect(
        screen.getByText("The judged text and the questions asked about it are sent to LangWatch."),
      ).toBeDefined();
      expect(
        screen.getByText("Calls to your own providers are unaffected and are never sent."),
      ).toBeDefined();
    });

    /** @scenario "A member who is not an admin cannot switch a service on" */
    it("disables every switch for a member who cannot manage the organization", () => {
      renderScreen({ status: connected(), admin: false });
      expect(switchOf("instant_evals").disabled).toBe(true);
    });

    /** @scenario "The page marks a service the license does not include" */
    it("marks a service outside the license and keeps its switch off", () => {
      renderScreen({ status: connected() });
      expect(screen.getByText("Not included in your license")).toBeDefined();
      expect(switchOf("managed_models").disabled).toBe(true);
    });

    /** @scenario "The page shows spend, cap and remaining credit" */
    it("shows spend, cap and remaining against the contract", () => {
      const budget = {
        id: "budget-1",
        scope: "organization",
        window: "month",
        capUsd: 500,
        spentUsd: 120,
        remainingUsd: 380,
        onBreach: "block",
        periodStartedAt: "2026-09-01T00:00:00.000Z",
        isContract: true,
      };
      renderScreen({
        status: connected({
          usage: {
            services: ["instant_evals"],
            spendAvailable: true,
            readAt: "2026-09-22T00:00:00.000Z",
            contract: {
              ...budget,
              commitUsd: 500,
              maximumCapUsd: 1000,
              overageEnabled: false,
              termEndsAt: null,
            },
            budgets: [budget],
          },
        }),
      });
      expect(screen.getByText("120.00 USD")).toBeDefined();
      expect(screen.getByText("500.00 USD")).toBeDefined();
      expect(screen.getByText("380.00 USD")).toBeDefined();
    });
  });

  describe("given the usage read could not reach LangWatch", () => {
    /** @scenario "The page shows usage as unavailable when LangWatch cannot be reached" */
    it("says usage is unavailable, keeps the services, and raises no error", () => {
      renderScreen({
        status: connected({ entitledServices: null, usage: null, isUsageUnavailable: true }),
      });
      expect(screen.getByTestId("connect-usage-unavailable")).toBeDefined();
      expect(screen.getByText(/Usage unavailable/)).toBeDefined();
      expect(screen.getByTestId("connect-services")).toBeDefined();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("given an operator switched Connect off for the deployment", () => {
    /** @scenario "The page explains a deployment where an operator switched Connect off" */
    it("says nothing is sent and how to switch it back on", () => {
      renderScreen({ status: { deployment: "off" } });
      expect(screen.getByTestId("connect-deployment-off")).toBeDefined();
      expect(screen.getByText(/LANGWATCH_CONNECT_DISABLED/)).toBeDefined();
    });
  });
});
