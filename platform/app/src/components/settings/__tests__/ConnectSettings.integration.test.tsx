/**
 * @vitest-environment jsdom
 *
 * Settings, Connect is where an administrator of a self-hosted install decides
 * which LangWatch-hosted services it may call. Nothing is sent until they
 * switch one on, so the page has to state what leaves the install before the
 * switch is touched, refuse the decision to anyone without organization
 * management rights, and show the spend those services are charged against.
 *
 * Spec: specs/self-hosting/connected-services/connect-settings.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  statusRef,
  canManageRef,
  capFailureRef,
  setServiceMutate,
  setCapMutate,
  refetchMock,
  toasterCreate,
} = vi.hoisted(() => ({
  statusRef: { current: undefined as unknown },
  canManageRef: { current: true },
  capFailureRef: { current: null as unknown },
  setServiceMutate: vi.fn(),
  setCapMutate: vi.fn(),
  refetchMock: vi.fn(),
  toasterCreate: vi.fn(),
}));

interface MutationOptions {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

vi.mock("~/utils/api", () => ({
  api: {
    connect: {
      status: {
        useQuery: () => ({
          data: statusRef.current,
          isLoading: false,
          error: null,
          refetch: refetchMock,
        }),
      },
      setService: {
        useMutation: (options?: MutationOptions) => ({
          mutate: (variables: unknown) => {
            setServiceMutate(variables);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      setCap: {
        useMutation: (options?: MutationOptions) => ({
          mutate: (variables: unknown) => {
            setCapMutate(variables);
            if (capFailureRef.current) {
              options?.onError?.(capFailureRef.current);
              return;
            }
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-acme", name: "ACME" },
    hasPermission: () => canManageRef.current,
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: toasterCreate },
}));

import { ConnectSettings } from "../ConnectSettings";

const INSTANT_EVALS_SWITCH = "connect-service-switch-instant_evals";

const contract = {
  capUsd: 1000,
  spentUsd: 120,
  remainingUsd: 880,
  commitUsd: 1000,
  maximumCapUsd: 5000,
  overageEnabled: false,
  periodStartedAt: "2026-09-01T12:00:00.000Z",
  termEndsAt: null,
};

const connectedStatus = (overrides: Record<string, unknown> = {}) => ({
  deployment: "on",
  gatewayHost: "gateway.langwatch.ai",
  licensed: true,
  enabledServices: [] as string[],
  entitledServices: ["instant_evals"],
  usage: {
    services: ["instant_evals"],
    spendAvailable: true,
    readAt: "2026-09-19T09:00:00.000Z",
    contract,
    budgets: [],
  },
  refusal: null,
  ...overrides,
});

const renderSettings = (status: unknown) => {
  statusRef.current = status;
  render(
    <ChakraProvider value={defaultSystem}>
      <ConnectSettings organizationId="org-acme" />
    </ChakraProvider>,
  );
};

const switchInput = () =>
  screen.getByTestId(INSTANT_EVALS_SWITCH) as HTMLInputElement;

describe("<ConnectSettings />", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canManageRef.current = true;
    capFailureRef.current = null;
  });

  afterEach(cleanup);

  describe("given a licensed install with Connect enabled", () => {
    /** @scenario Every hosted service starts switched off */
    it("lists Instant Evals as available, switched off, and asks the host for nothing", () => {
      renderSettings(connectedStatus());

      expect(screen.getByText("Instant Evals")).toBeDefined();
      expect(screen.getByText("Available, switched off")).toBeDefined();
      expect(switchInput().checked).toBe(false);
      expect(setServiceMutate).not.toHaveBeenCalled();
    });

    /** @scenario The page states what leaves the install before a service is switched on */
    it("states what is sent, that it is not stored, and what is never sent", () => {
      renderSettings(connectedStatus());

      expect(
        screen.getByText(
          "The judged text and the questions asked about it are sent to LangWatch.",
        ),
      ).toBeDefined();
      expect(screen.getByText("They are not stored.")).toBeDefined();
      expect(
        screen.getByText("Traces, prompts and datasets are never sent."),
      ).toBeDefined();
    });

    describe("when an admin switches Instant Evals on", () => {
      /** @scenario Switching a service on is an admin decision that is recorded */
      it("asks the organization to switch the service on and reloads its state", async () => {
        renderSettings(connectedStatus());

        fireEvent.click(switchInput());

        await waitFor(() => {
          expect(setServiceMutate).toHaveBeenCalledWith({
            organizationId: "org-acme",
            service: "instant_evals",
            enabled: true,
          });
        });
        expect(refetchMock).toHaveBeenCalled();
      });
    });
  });

  describe("given a member without organization management rights", () => {
    beforeEach(() => {
      canManageRef.current = false;
    });

    /** @scenario A member who is not an admin cannot switch a service on */
    it("shows the status but offers no switch and no cap field", () => {
      renderSettings(connectedStatus({ enabledServices: ["instant_evals"] }));

      expect(screen.getByText("Instant Evals")).toBeDefined();
      expect(screen.getByText("1000.00 USD")).toBeDefined();
      expect(switchInput().disabled).toBe(true);
      expect(screen.queryByTestId("connect-cap-input")).toBeNull();
    });
  });

  describe("given a license that does not include Instant Evals", () => {
    /** @scenario The page marks a service the license does not include */
    it("says it is not included and leaves the switch dead", () => {
      renderSettings(connectedStatus({ entitledServices: [] }));

      expect(screen.getByText("Not included in your license")).toBeDefined();
      expect(switchInput().disabled).toBe(true);
    });
  });

  describe("given spend reported for the period", () => {
    /** @scenario The page shows spend, cap and remaining credit */
    it("shows spent, cap, remaining and the period they cover", () => {
      renderSettings(connectedStatus());

      expect(screen.getByText("120.00 USD")).toBeDefined();
      expect(screen.getByText("1000.00 USD")).toBeDefined();
      expect(screen.getByText("880.00 USD")).toBeDefined();
      expect(
        screen.getByText(/For the period that started on .*2026/),
      ).toBeDefined();
    });

    describe("when spend cannot be read", () => {
      /** @scenario The page says when spend cannot be read */
      it("says spend is not available right now and still shows the cap", () => {
        renderSettings(
          connectedStatus({
            usage: {
              services: ["instant_evals"],
              spendAvailable: false,
              readAt: "2026-09-19T09:00:00.000Z",
              contract: { ...contract, spentUsd: null, remainingUsd: null },
              budgets: [],
            },
          }),
        );

        expect(
          screen.getAllByText("Spend is not available right now").length,
        ).toBe(2);
        expect(screen.getByText("1000.00 USD")).toBeDefined();
      });
    });

    describe("when an admin sets the cap to 400 USD", () => {
      /** @scenario An admin changes the cap */
      it("asks for a 400 USD cap and reloads the figures", () => {
        renderSettings(connectedStatus());

        fireEvent.change(screen.getByTestId("connect-cap-input"), {
          target: { value: "400" },
        });
        fireEvent.click(screen.getByTestId("connect-cap-save"));

        expect(setCapMutate).toHaveBeenCalledWith({
          organizationId: "org-acme",
          capUsd: 400,
        });
        expect(refetchMock).toHaveBeenCalled();
      });
    });

    describe("when the cap is above the contract maximum", () => {
      /** @scenario A cap above the contract maximum is shown on the field */
      it("puts the maximum on the field and leaves the cap as it was", () => {
        capFailureRef.current = {
          data: {
            error: {
              code: "connect_budget_above_contract_maximum",
              httpStatus: 400,
              fault: "customer",
              meta: { maximumUsd: 5000 },
            },
          },
        };
        renderSettings(connectedStatus());

        fireEvent.change(screen.getByTestId("connect-cap-input"), {
          target: { value: "9000" },
        });
        fireEvent.click(screen.getByTestId("connect-cap-save"));

        expect(
          screen.getByText(/The highest cap you can set is 5000.00 USD/),
        ).toBeDefined();
        expect(screen.getByText("1000.00 USD")).toBeDefined();
      });
    });
  });

  describe("given Connect is switched off for the deployment", () => {
    /** @scenario The page explains a deployment with Connect switched off */
    it("explains that nothing is sent and what switches it on", () => {
      renderSettings({ deployment: "off" });

      expect(
        screen.getByText("Connect is switched off for this deployment"),
      ).toBeDefined();
      expect(
        screen.getByText(/Nothing is sent to LangWatch from this install/),
      ).toBeDefined();
      expect(screen.queryByTestId(INSTANT_EVALS_SWITCH)).toBeNull();
    });
  });

  describe("given an organization with no license", () => {
    /** @scenario The page sends an organization with no license to the license page */
    it("explains that hosted services need a license and links to the license page", () => {
      renderSettings(connectedStatus({ licensed: false }));

      expect(screen.getByText("Hosted services need a license")).toBeDefined();
      expect(
        screen.getByRole("link", { name: "License" }).getAttribute("href"),
      ).toBe("/settings/license");
    });
  });

  describe("given LangWatch refuses the license", () => {
    /** @scenario The page shows a refusal in place of the hosted services */
    it("shows the unregistered license and how to have it registered", () => {
      renderSettings(
        connectedStatus({
          entitledServices: null,
          usage: null,
          refusal: { code: "connect_license_not_registered" },
        }),
      );

      expect(
        screen.getByText("This license is not set up for hosted services"),
      ).toBeDefined();
      expect(
        screen.getByText(
          "Contact LangWatch to have hosted services enabled for your license.",
        ),
      ).toBeDefined();
    });

    /** @scenario The page shows a refusal in place of the hosted services */
    it("says the license belongs to another install and that the binding can be reset", () => {
      renderSettings(
        connectedStatus({
          entitledServices: null,
          usage: null,
          refusal: { code: "connect_wrong_instance" },
        }),
      );

      expect(
        screen.getByText("This license is in use by another install"),
      ).toBeDefined();
      expect(
        screen.getByText(/ask LangWatch to reset the license binding/),
      ).toBeDefined();
    });
  });
});
