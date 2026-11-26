/**
 * The mount reads the subscription's currency off the organization's active plan.
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */
import {
  UiHostServicesContextProvider,
  UiScope,
  UiSession,
  type UiActiveScope,
  type UiHostServices,
} from "@langwatch/browser-host/capabilities";
import type { UiSessionSnapshot } from "@langwatch/browser-host/session";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

type PlanQuery = {
  isLoading: boolean;
  isError: boolean;
  data?: { type: string };
  refetch?: () => Promise<unknown>;
};
const activePlan = vi.fn((): PlanQuery => ({
  isLoading: false,
  isError: false,
  data: { type: "FREE" },
}));
vi.mock("../data-privacy-api.ts", () => ({
  dataPrivacyApi: { plan: { getActivePlan: { useQuery: () => activePlan() } } },
}));

import { useDataPrivacyHost } from "../../model/data-privacy-host.ts";
import DataPrivacyHostMount from "../data-privacy-host-mount.tsx";

class TestScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: "proj-1" };
  }
}

class OrganizationViewer extends UiSession {
  currentUser() {
    return null;
  }

  hasPermission(): boolean {
    return true;
  }

  isSettled(): boolean {
    return true;
  }

  override snapshot(): UiSessionSnapshot {
    return {
      session: { status: "anonymous", user: null },
      scope: { status: "ready", organization: { id: "org-1" }, team: undefined, project: void 0 },
      permissions: {
        status: "ready",
        isLoading: false,
        can: () => true,
        canInOrganization: () => true,
      },
    };
  }
}

function CurrencyReader() {
  const host = useDataPrivacyHost();
  return (
    <>
      <span data-testid="currency">{host.billingCurrency()}</span>
      <button type="button" onClick={() => void host.refreshBillingCurrency()}>
        Read the plan again
      </button>
    </>
  );
}

function renderOnCloud() {
  const services: UiHostServices = {
    ...createUiHostServicesFromHost(
      { route: () => ({ params: {}, query: {} }), navigate: () => void 0 },
      new OrganizationViewer(),
    ),
    scope: new TestScope(),
    deployment: {
      isDevelopment: false,
      isSaaS: true,
      appBaseUrl: "http://localhost",
      hasNlpService: true,
      hasLangevals: true,
      hasEmailProvider: false,
      hasCloudOps: false,
    },
  };
  render(
    <UiHostServicesContextProvider value={services}>
      <DataPrivacyHostMount>
        <CurrencyReader />
      </DataPrivacyHostMount>
    </UiHostServicesContextProvider>,
  );
}

describe("given the Data Privacy host mounted on LangWatch Cloud", () => {
  describe("when the organization's active plan is a euro Growth seat plan", () => {
    /** @scenario "Strict shows the euro price to an organization on a euro Growth subscription" */
    it("reads the subscription's currency as euros", () => {
      activePlan.mockReturnValue({
        isLoading: false,
        isError: false,
        data: { type: "GROWTH_SEAT_EUR_MONTHLY" },
      });

      renderOnCloud();

      expect(screen.getByTestId("currency")).toHaveTextContent("EUR");
    });
  });

  describe("when the plan read fails", () => {
    /** @scenario "A Strict rule save waits for the subscription's currency" */
    it("reads the currency as unknown, never dollars", () => {
      activePlan.mockReturnValue({ isLoading: false, isError: true });

      renderOnCloud();

      expect(screen.getByTestId("currency")).toHaveTextContent("unknown");
    });
  });

  describe("when a refresh fails after the plan answered in euros", () => {
    /** @scenario "A Strict rule save waits for the subscription's currency" */
    it("keeps reading euros", () => {
      activePlan.mockReturnValue({
        isLoading: false,
        isError: true,
        data: { type: "GROWTH_SEAT_EUR_MONTHLY" },
      });

      renderOnCloud();

      expect(screen.getByTestId("currency")).toHaveTextContent("EUR");
    });
  });

  describe("when a waiting save asks for the plan again", () => {
    /** @scenario "A Strict rule save waits for the subscription's currency" */
    it("refetches the plan query", async () => {
      const refetch = vi.fn(async () => ({}));
      activePlan.mockReturnValue({ isLoading: false, isError: true, refetch });

      renderOnCloud();
      await userEvent.setup().click(screen.getByRole("button", { name: "Read the plan again" }));

      await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    });
  });
});
