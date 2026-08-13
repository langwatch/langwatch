/**
 * @vitest-environment jsdom
 *
 * The create drawer is where a key's four decisions get made: where it
 * lives and where its traces land, what it may spend, which providers it
 * may reach, and whether it fails over. These tests render the real
 * component tree (ownership chips, budget field, provider checkboxes,
 * routing radios, real Chakra) and mock only the network boundary, so
 * what is asserted is what a person sees and what the wire receives.
 *
 * Spec: specs/ai-gateway/virtual-key-creation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VirtualKeyCreateDrawer } from "../VirtualKeyCreateDrawer";

const ORG_ID = "org-acme";
const TEAM_ID = "team-platform";
const PROJECT_ID = "project-web-app";
const PERSONAL_PROJECT_ID = "project-personal";
const USER_ID = "user-1";

type ApplicableBudget = {
  id: string;
  name: string;
  scopeType: string;
  scopeId: string;
  scopeLabel: string;
  window: string;
  limitUsd: string;
  spentUsd: string;
  onBreach: string;
  timezone: string | null;
  providerKey: string | null;
  providerLabel: string | null;
  isPerMember: boolean;
  managedByVirtualKeyId: string | null;
};

const { createMutateAsync, applicableBudgetsData, capturedApplicableInputs } =
  vi.hoisted(() => ({
    createMutateAsync: vi.fn(),
    applicableBudgetsData: { rows: [] as ApplicableBudget[] },
    capturedApplicableInputs: [] as unknown[],
  }));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: {
      id: ORG_ID,
      name: "ACME",
      teams: [
        {
          id: TEAM_ID,
          name: "platform",
          projects: [{ id: PROJECT_ID, name: "web-app" }],
        },
      ],
    },
    team: { id: TEAM_ID, name: "platform" },
    project: { id: PROJECT_ID, name: "web-app" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { id: USER_ID, name: "Ada", email: "ada@acme.test" } },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      virtualKeys: {
        list: { invalidate: async () => undefined },
        applicableBudgets: { invalidate: async () => undefined },
      },
    }),
    virtualKeys: {
      create: {
        useMutation: () => ({
          mutateAsync: createMutateAsync,
          isPending: false,
        }),
      },
      applicableBudgets: {
        useQuery: (input: unknown, opts?: { enabled?: boolean }) => {
          if (opts?.enabled !== false) capturedApplicableInputs.push(input);
          return {
            data:
              opts?.enabled === false ? undefined : applicableBudgetsData.rows,
          };
        },
      },
    },
    modelProvider: {
      listAllForOrganizationForFrontend: {
        useQuery: () => ({
          data: {
            providers: [
              {
                id: "mp-openai",
                name: "OpenAI",
                provider: "openai",
                enabled: true,
                scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
                models: ["gpt-5-mini", "gpt-5"],
              },
              {
                id: "mp-anthropic",
                name: "Anthropic",
                provider: "anthropic",
                enabled: true,
                scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
                models: ["claude-sonnet-4-5"],
              },
            ],
          },
          isLoading: false,
        }),
      },
    },
    routingPolicy: {
      list: {
        useQuery: () => ({
          data: [{ id: "policy-eu", name: "EU providers only" }],
        }),
      },
    },
    user: {
      personalContext: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => ({
          data:
            opts?.enabled === false
              ? undefined
              : {
                  workspace: {
                    project: { id: PERSONAL_PROJECT_ID },
                    team: { id: "team-personal" },
                  },
                },
        }),
      },
    },
  },
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderDrawer = () =>
  render(
    <VirtualKeyCreateDrawer
      organizationId={ORG_ID}
      open
      onOpenChange={() => undefined}
      onCreated={() => undefined}
    />,
    { wrapper: Wrapper },
  );

const lastCreateInput = (): Record<string, any> => {
  const call = createMutateAsync.mock.calls.at(-1);
  if (!call) throw new Error("create was never called");
  return call[0] as Record<string, any>;
};

const submit = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
};

describe("given the new-virtual-key drawer", () => {
  beforeEach(() => {
    createMutateAsync.mockReset();
    createMutateAsync.mockResolvedValue({
      virtualKey: { id: "vk-new", name: "test-key" },
      secret: "vk-lw-secret",
    });
    applicableBudgetsData.rows = [];
    capturedApplicableInputs.length = 0;
  });

  afterEach(() => cleanup());

  describe("when it opens for the current project", () => {
    /** @scenario The drawer states where this key's traces and costs will land */
    it("states that traces and costs land in that project", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(
          screen.getByTestId("vk-trace-destination").textContent,
        ).toContain("Traces and costs land in web-app");
      });
    });

    /** @scenario A new key defaults to no fallback */
    it("defaults routing to no fallback and persists NONE", async () => {
      renderDrawer();

      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().routingMode).toBe("NONE");
      expect(lastCreateInput().routingPolicyId).toBeNull();
    });
  });

  describe("when the budget field is left empty", () => {
    /** @scenario An empty budget field means no cap, and says so */
    it("says there is no maximum spend and creates no budget", async () => {
      renderDrawer();

      expect(screen.getByTestId("vk-budget-annotation").textContent).toContain(
        "No max spending for this key",
      );

      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().budget).toBeNull();
    });
  });

  describe("when a limit of $30 per day is set", () => {
    /** @scenario A filled budget states its limit, its period and when it resets */
    it("states the maximum and the UTC reset time", async () => {
      renderDrawer();

      await userEvent.type(screen.getByTestId("vk-budget-limit"), "30");

      expect(screen.getByTestId("vk-budget-annotation").textContent).toBe(
        "Max $30/day, resets 00:00 UTC",
      );
    });

    it("offers no timezone choice, because resets are computed in UTC only", async () => {
      // budgetWindow.ts computes every reset in UTC. A timezone picker
      // here would display a promise enforcement does not keep; the
      // control returns when resets honor a configured timezone.
      renderDrawer();

      await userEvent.type(screen.getByTestId("vk-budget-limit"), "30");

      expect(
        screen.queryByTestId("vk-budget-customize-reset"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("vk-budget-timezone"),
      ).not.toBeInTheDocument();

      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().budget).toEqual({
        limitUsd: "30",
        window: "DAY",
      });
    });

    it("persists the chosen period", async () => {
      renderDrawer();

      await userEvent.type(screen.getByTestId("vk-budget-limit"), "30");
      await userEvent.selectOptions(
        screen.getByTestId("vk-budget-window"),
        "WEEK",
      );
      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().budget).toEqual({
        limitUsd: "30",
        window: "WEEK",
      });
    });
  });

  describe("when budgets already constrain the draft key", () => {
    /** @scenario The drawer lists the budgets that already constrain this key */
    it("lists each with its limit, period and current spend, saying which count one provider and which are per member", async () => {
      applicableBudgetsData.rows = [
        {
          id: "budget-org",
          name: "Org monthly",
          scopeType: "ORGANIZATION",
          scopeId: ORG_ID,
          scopeLabel: "ACME",
          window: "MONTH",
          limitUsd: "1000",
          spentUsd: "250",
          onBreach: "BLOCK",
          timezone: null,
          providerKey: null,
          providerLabel: null,
          isPerMember: false,
          managedByVirtualKeyId: null,
        },
        {
          id: "budget-project",
          name: "web-app monthly",
          scopeType: "PROJECT",
          scopeId: PROJECT_ID,
          scopeLabel: "web-app",
          window: "MONTH",
          limitUsd: "100",
          spentUsd: "12.5",
          onBreach: "BLOCK",
          timezone: null,
          providerKey: "mp-openai",
          providerLabel: "OpenAI",
          isPerMember: false,
          managedByVirtualKeyId: null,
        },
        {
          id: "budget-dept",
          name: "Engineering per-member",
          scopeType: "GROUP",
          scopeId: "group-eng",
          scopeLabel: "Engineering",
          window: "DAY",
          limitUsd: "5",
          spentUsd: "0",
          onBreach: "BLOCK",
          timezone: null,
          providerKey: null,
          providerLabel: null,
          isPerMember: true,
          managedByVirtualKeyId: null,
        },
      ];
      renderDrawer();

      const list = await screen.findByTestId("vk-applicable-budgets");
      expect(list.textContent).toContain("Inherited budgets");
      expect(list.textContent).toContain("ACME");
      expect(list.textContent).toContain("$250.00 of $1000.00 / month");
      expect(list.textContent).toContain("web-app");
      expect(list.textContent).toContain("$12.50 of $100.00 / month");
      expect(list.textContent).toContain("OpenAI only");
      expect(list.textContent).toContain("Engineering");
      expect(list.textContent).toContain("per member");
    });

    it("resolves the list for the draft's own scopes", async () => {
      renderDrawer();

      await waitFor(() =>
        expect(capturedApplicableInputs.length).toBeGreaterThan(0),
      );
      expect(capturedApplicableInputs.at(-1)).toMatchObject({
        organizationId: ORG_ID,
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
      });
    });
  });

  describe("when all providers stays ticked", () => {
    /** @scenario Allowing all providers keeps future providers included */
    it("persists the absence of a list, the shape that includes future providers", async () => {
      renderDrawer();

      await waitFor(() =>
        expect(screen.getByTestId("vk-providers-all")).toBeInTheDocument(),
      );
      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().config.providersAllowed).toBeNull();
    });
  });

  describe("when the selection is narrowed to one provider", () => {
    /** @scenario An explicit provider list narrows what the key can reach */
    it("persists exactly the picked provider ids", async () => {
      renderDrawer();

      await userEvent.click(screen.getByTestId("vk-providers-all"));
      // Unticking All starts from everything selected; narrowing is one
      // uncheck away.
      await userEvent.click(screen.getByTestId("vk-provider-mp-anthropic"));
      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().config.providersAllowed).toEqual(["mp-openai"]);
    });
  });

  describe("when every provider is unticked", () => {
    /** @scenario Unticking every provider is refused rather than saved */
    it("refuses to save and says why", async () => {
      renderDrawer();

      await userEvent.click(screen.getByTestId("vk-providers-all"));
      await userEvent.click(screen.getByTestId("vk-provider-mp-openai"));
      await userEvent.click(screen.getByTestId("vk-provider-mp-anthropic"));
      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");

      expect(screen.getByTestId("vk-providers-invalid").textContent).toContain(
        "Select at least one provider, or allow all providers.",
      );
      expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
      expect(createMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe("when a provider's model accordion narrows its models", () => {
    it("writes the checked models as vendor-prefixed ids in models_allowed", async () => {
      renderDrawer();

      await userEvent.click(
        screen.getByTestId("vk-provider-mp-openai-models-toggle"),
      );
      await userEvent.click(screen.getByTestId("vk-model-openai/gpt-5-mini"));
      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().config.modelsAllowed).toEqual([
        "openai/gpt-5-mini",
      ]);
    });

    it("leaves models_allowed absent when nothing is checked", async () => {
      renderDrawer();

      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().config.modelsAllowed).toBeNull();
    });
  });

  describe("when the key is owned by the organization", () => {
    /** @scenario A key owned above a project is refused until its traces have a home */
    it("requires picking the project where traces and costs land before it can be created", async () => {
      renderDrawer();

      await userEvent.click(screen.getByTestId("vk-ownership-organization"));
      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");

      expect(
        screen.getByText("Pick the project where traces and costs land."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
      expect(createMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe("when the key is personal", () => {
    it("lands its traces in the creator's personal workspace and names them as the principal", async () => {
      renderDrawer();

      await userEvent.click(screen.getByTestId("vk-ownership-personal"));

      await waitFor(() => {
        expect(
          screen.getByTestId("vk-trace-destination").textContent,
        ).toContain("personal workspace");
      });

      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().principalUserId).toBe(USER_ID);
      expect(lastCreateInput().scopes).toEqual([
        { scopeType: "PROJECT", scopeId: PERSONAL_PROJECT_ID },
      ]);
    });
  });

  describe("when fallback to all eligible providers is chosen", () => {
    it("persists FALLBACK_ALL with no policy reference", async () => {
      renderDrawer();

      await userEvent.click(screen.getByTestId("vk-routing-fallback-all"));
      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().routingMode).toBe("FALLBACK_ALL");
      expect(lastCreateInput().routingPolicyId).toBeNull();
    });
  });

  describe("when a custom routing policy is chosen", () => {
    it("persists POLICY with the policy id", async () => {
      renderDrawer();

      await userEvent.click(screen.getByTestId("vk-routing-policy-policy-eu"));
      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().routingMode).toBe("POLICY");
      expect(lastCreateInput().routingPolicyId).toBe("policy-eu");
    });
  });
});
