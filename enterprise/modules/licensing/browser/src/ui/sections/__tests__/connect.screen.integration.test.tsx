/**
 * @vitest-environment jsdom
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { describeError } from "@langwatch/browser-host/errors";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { ConnectStatus } from "@langwatch/enterprise-licensing-contract";
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const refetch = vi.fn();
const capSaved: { onSuccess?: () => void; onError?: (error: unknown) => void } = {};

vi.mock("../../../behavior/connect-api.ts", () => ({
  connectApi: {
    connect: {
      status: {
        useQuery: () => ({ isLoading: false, error: null, data: answer.status, refetch }),
      },
      setService: { useMutation: () => mutation },
      setCap: {
        useMutation: (options: { onSuccess?: () => void; onError?: (error: unknown) => void }) => {
          capSaved.onSuccess = options.onSuccess;
          capSaved.onError = options.onError;
          return mutation;
        },
      },
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

class ExplainingHost extends TestHost {
  describeFailure(failure: LicensingFailureNotice) {
    return describeError(failure);
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

function screenFor({ admin, explains = false }: { admin: boolean; explains?: boolean }) {
  const host = explains ? new ExplainingHost(admin) : new TestHost(admin);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <LicensingHostProvider value={host}>{children}</LicensingHostProvider>
  );
  return (
    <Wrapper>
      <ConnectScreen />
    </Wrapper>
  );
}

function renderScreen({
  status,
  admin = true,
  explains = false,
}: {
  status: ConnectStatus;
  admin?: boolean;
  explains?: boolean;
}) {
  answer.status = status;
  return renderWithDesignSystem(screenFor({ admin, explains }));
}

function budgetOf({ capUsd, spentUsd }: { capUsd: number; spentUsd: number }) {
  return {
    id: "budget-1",
    scope: "organization",
    window: "month",
    capUsd,
    spentUsd,
    remainingUsd: capUsd - spentUsd,
    onBreach: "block",
    periodStartedAt: "2026-09-01T00:00:00.000Z",
    isContract: true,
  };
}

function usageOf({ capUsd, spendAvailable = true }: { capUsd: number; spendAvailable?: boolean }) {
  const budget = budgetOf({ capUsd, spentUsd: 120 });
  return {
    services: ["instant_evals"],
    spendAvailable,
    readAt: "2026-09-22T00:00:00.000Z",
    contract: {
      ...budget,
      commitUsd: 500,
      maximumCapUsd: 1000,
      overageEnabled: false,
      termEndsAt: null,
    },
    budgets: [budget],
  };
}

function switchOf(service: string): HTMLInputElement {
  const input = screen.getByTestId(`connect-service-switch-${service}`);
  if (!(input instanceof HTMLInputElement)) throw new Error("the switch is not an input");
  return input;
}

afterEach(() => {
  cleanup();
  mutation.mutate.mockClear();
  refetch.mockReset();
});

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
  describe("given a licensed install whose hosted usage route cannot report spend", () => {
    /** @scenario "The page says when spend cannot be read" */
    it("says spend is not available right now and still shows the cap", () => {
      renderScreen({
        status: connected({ usage: usageOf({ capUsd: 500, spendAvailable: false }) }),
      });

      expect(screen.getAllByText("Spend is not available right now")).toHaveLength(2);
      expect(screen.queryByText("120.00 USD")).toBeNull();
      expect(screen.getByText("500.00 USD")).toBeDefined();
    });
  });

  describe("given an admin of a licensed install with a contract budget", () => {
    /** @scenario "An admin changes the cap" */
    it("sends the cap typed in and shows the cap the refreshed status carries", async () => {
      const user = userEvent.setup();
      const view = renderScreen({ status: connected({ usage: usageOf({ capUsd: 500 }) }) });

      const field = screen.getByTestId("connect-cap-input");
      await user.clear(field);
      await user.type(field, "400");
      await user.click(screen.getByTestId("connect-cap-save"));

      expect(mutation.mutate).toHaveBeenCalledWith({ organizationId: "org-1", capUsd: 400 });

      refetch.mockImplementation(() => {
        answer.status = connected({ usage: usageOf({ capUsd: 400 }) });
        view.rerender(screenFor({ admin: true }));
      });
      act(() => capSaved.onSuccess?.());

      expect(refetch).toHaveBeenCalledTimes(1);
      expect(screen.getByText("400.00 USD")).toBeDefined();
      expect(screen.queryByText("500.00 USD")).toBeNull();
    });
  });

  describe("given an admin who sets a cap above the contract maximum", () => {
    /** @scenario "A cap above the contract maximum is shown on the field" */
    it("shows the maximum the server sent on the field and leaves the cap as it was", async () => {
      const user = userEvent.setup();
      renderScreen({
        explains: true,
        status: connected({ usage: usageOf({ capUsd: 500 }) }),
      });

      await user.clear(screen.getByTestId("connect-cap-input"));
      await user.type(screen.getByTestId("connect-cap-input"), "9000");
      await user.click(screen.getByTestId("connect-cap-save"));
      act(() =>
        capSaved.onError?.({
          data: {
            error: {
              code: "connect_budget_above_contract_maximum",
              httpStatus: 400,
              fault: "customer",
              meta: { maximumUsd: 5000 },
            },
          },
        }),
      );

      expect(screen.getByText(/The highest cap you can set is 5000.00 USD/)).toBeDefined();
      expect(refetch).not.toHaveBeenCalled();
      expect(screen.getByText("500.00 USD")).toBeDefined();
    });
  });

  describe("given an organization with no license", () => {
    /** @scenario "The page sends an organization with no license to the license page" */
    it("says hosted services need a license and links to the license page", () => {
      renderScreen({ status: connected({ licensed: false, enabledServices: [], usage: null }) });

      expect(screen.getByText("Hosted services need a license")).toBeDefined();
      const link = screen.getByRole("link", { name: "Open the License page" });
      expect(link.getAttribute("href")).toBe("/settings/license");
    });
  });

  describe("given the hosted service refuses the license", () => {
    /** @scenario "The page shows a refusal in place of the hosted services" */
    it("says what the refusal means and what to do about it, keeping the services' settings", () => {
      renderScreen({
        explains: true,
        status: connected({ refusal: { code: "connect_license_revoked" } }),
      });

      const refusal = screen.getByTestId("connect-refusal");
      expect(refusal.textContent).toContain("This license is no longer active");
      expect(refusal.textContent).toContain("Contact LangWatch for a new license");
      expect(switchOf("instant_evals").checked).toBe(true);
    });
  });
});
