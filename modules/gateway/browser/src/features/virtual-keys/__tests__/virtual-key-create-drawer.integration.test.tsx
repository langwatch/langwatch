/**
 * @vitest-environment jsdom
 * Ownership, budget, providers, failover — real component tree, network mocked only.
 * Spec: specs/ai-gateway/virtual-key-creation.feature
 */
import type { Instant } from "@langwatch/time";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing.tsx";
import { VirtualKeyCreateDrawer } from "../ui/sections/virtual-key-create-drawer.tsx";

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

const { createMutateAsync, applicableBudgetsData, capturedApplicableInputs } = vi.hoisted(() => ({
  createMutateAsync: vi.fn(),
  applicableBudgetsData: { rows: [] as ApplicableBudget[] },
  capturedApplicableInputs: [] as unknown[],
}));

vi.mock("../../../behavior/gateway-api.ts", () => ({
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
            data: opts?.enabled === false ? undefined : applicableBudgetsData.rows,
          };
        },
      },
    },
    modelProvider: {
      listAllForOrganizationForFrontend: {
        useQuery: () => ({
          data: [
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

/**
 * The application the drawer is mounted in: one org, one team, one project,
 * an admin, and a reader whose id a personal key is stamped with. Answers
 * `useOrganizationTeamProject` and `useRequiredSession`.
 */
const host = fakeGatewayHost({
  permissions: ["virtualKeys:manage"],
  organization: {
    id: ORG_ID,
    name: "ACME",
    slug: "acme",
    teams: [
      {
        id: TEAM_ID,
        name: "platform",
        projects: [{ id: PROJECT_ID, name: "web-app", slug: "web-app", teamId: TEAM_ID }],
      },
    ],
  },
  currentUser: { id: USER_ID, name: "Ada", email: "ada@acme.test" },
});

const renderDrawer = () =>
  renderWithGatewayHost(
    <VirtualKeyCreateDrawer
      organizationId={ORG_ID}
      open
      onOpenChange={() => undefined}
      onCreated={() => undefined}
    />,
    { host },
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
        expect(screen.getByTestId("vk-trace-destination").textContent).toContain(
          "Traces and costs land in web-app",
        );
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

      expect(screen.queryByTestId("vk-budget-customize-reset")).not.toBeInTheDocument();
      expect(screen.queryByTestId("vk-budget-timezone")).not.toBeInTheDocument();

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
      await userEvent.selectOptions(screen.getByTestId("vk-budget-window"), "WEEK");
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

      await waitFor(() => expect(capturedApplicableInputs.length).toBeGreaterThan(0));
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

      await waitFor(() => expect(screen.getByTestId("vk-providers-all")).toBeInTheDocument());
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
      // Unchecking "All providers" clears the selection; pick one provider to
      // narrow the key to exactly it.
      await userEvent.click(screen.getByTestId("vk-provider-mp-openai"));
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

      // Unchecking "All providers" clears the selection, so no provider is
      // picked and the drawer refuses the save.
      await userEvent.click(screen.getByTestId("vk-providers-all"));
      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");

      expect(screen.getByTestId("vk-providers-invalid").textContent).toContain(
        "Select at least one provider, or allow all providers.",
      );
      expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
      await userEvent.click(screen.getByRole("button", { name: "Create" }));
      expect(createMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe("when a provider's model accordion narrows its models", () => {
    it("writes the checked models as vendor-prefixed ids in models_allowed", async () => {
      renderDrawer();

      await userEvent.click(screen.getByTestId("vk-provider-mp-openai-models-toggle"));
      await userEvent.click(screen.getByTestId("vk-model-openai/gpt-5-mini"));
      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().config.modelsAllowed).toEqual(["openai/gpt-5-mini"]);
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

      expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
      await userEvent.click(screen.getByRole("button", { name: "Create" }));
      expect(screen.getByText("Pick the project where traces and costs land.")).toBeInTheDocument();
      expect(createMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe("when the key is personal", () => {
    it("lands its traces in the creator's personal workspace and names them as the principal", async () => {
      renderDrawer();

      await userEvent.click(screen.getByTestId("vk-ownership-personal"));

      await waitFor(() => {
        expect(screen.getByTestId("vk-trace-destination").textContent).toContain(
          "personal workspace",
        );
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

  describe("when the expiration is left alone", () => {
    /** @scenario "The drawer offers an expiration and defaults to never" */
    it("says the key never expires and sends no date", async () => {
      renderDrawer();

      expect((screen.getByTestId("vk-expiration-preset") as HTMLSelectElement).value).toBe("");
      expect(screen.getByTestId("vk-expiration-resolved").textContent).toContain(
        "This key never expires",
      );

      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect(lastCreateInput().expiresAt).toBeUndefined();
    });
  });

  describe("when a period is picked", () => {
    /** @scenario "Picking a period states the date the key stops working" */
    it("states the resolved date and sends it with the key", async () => {
      renderDrawer();

      await userEvent.selectOptions(screen.getByTestId("vk-expiration-preset"), "7");

      const expected = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await waitFor(() => {
        expect(screen.getByTestId("vk-expiration-resolved").textContent).toContain(
          expected.toLocaleDateString("en-US", {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          }),
        );
      });

      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      const sent = lastCreateInput().expiresAt as Instant;
      // Within a minute of seven days out: the drawer resolves the period
      // as the person picks it, not as the request is built.
      expect(Math.abs(sent.epochMilliseconds - expected.getTime())).toBeLessThan(60_000);
    });
  });

  describe("when a custom date is picked", () => {
    /** @scenario "A custom date expires the key at the end of that day" */
    it("keeps the key working for the whole of that day", async () => {
      renderDrawer();

      await userEvent.selectOptions(screen.getByTestId("vk-expiration-preset"), "custom");
      const dateInput = await screen.findByTestId("vk-expiration-date");
      await userEvent.type(dateInput, "2030-08-20");

      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await submit();

      await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
      expect((lastCreateInput().expiresAt as Instant).toString({ fractionalSecondDigits: 3 })).toBe(
        "2030-08-20T23:59:59.999Z",
      );
    });

    it("holds the save until a date is actually typed", async () => {
      renderDrawer();

      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await userEvent.selectOptions(screen.getByTestId("vk-expiration-preset"), "custom");

      await userEvent.click(screen.getByRole("button", { name: "Create" }));
      expect(createMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe("when the server refuses the date", () => {
    /** @scenario "An expiration date in the past is refused" */
    it("paints the complaint under the expiration field", async () => {
      createMutateAsync.mockRejectedValueOnce({
        data: {
          error: {
            code: "virtual_key_expiry_in_past",
            httpStatus: 400,
            meta: {
              fieldErrors: { expiresAt: ["Pick a date in the future"] },
            },
          },
        },
      });
      renderDrawer();

      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "k");
      await userEvent.selectOptions(screen.getByTestId("vk-expiration-preset"), "custom");
      await userEvent.type(await screen.findByTestId("vk-expiration-date"), "2030-08-20");
      await submit();

      await waitFor(() => {
        expect(screen.getByText("Pick a date in the future")).toBeTruthy();
      });
    });
  });
});

describe("given a key that is minted while the drawer is open", () => {
  const SECRET = "vk-lw-secret-marker";
  const MINTED = {
    virtualKey: { id: "vk-new", name: "test-key" },
    secret: SECRET,
  };
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();

  const renderMintingDrawer = () =>
    renderWithGatewayHost(
      <VirtualKeyCreateDrawer
        organizationId={ORG_ID}
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
      { host },
    );

  const nameInput = () => screen.getByPlaceholderText("e.g. codex-prod") as HTMLInputElement;

  const createWithName = async () => {
    await userEvent.type(nameInput(), "test-key");
    await submit();
  };

  const handoffThrowsOnce = () =>
    onCreated.mockImplementationOnce(() => {
      throw new Error("could not open");
    });

  beforeEach(() => {
    createMutateAsync.mockReset();
    createMutateAsync.mockResolvedValue(MINTED);
    onCreated.mockReset();
    onOpenChange.mockReset();
    host.recording.failures.length = 0;
    host.recording.successes.length = 0;
    applicableBudgetsData.rows = [];
  });

  afterEach(() => cleanup());

  describe("when the create request is refused", () => {
    /** @scenario A refused create leaves the form editable and says it failed */
    it("keeps the form editable, raises the failure and hands nothing over", async () => {
      createMutateAsync.mockRejectedValueOnce(new Error("socket hang up"));
      renderMintingDrawer();

      await createWithName();

      await waitFor(() => expect(host.recording.failures).toHaveLength(1));
      expect(host.recording.failures[0]?.fallbackTitle).toBe("Failed to create virtual key");
      expect(nameInput().value).toBe("test-key");
      expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
      expect(onCreated).not.toHaveBeenCalled();
      expect(screen.queryByTestId("gateway-virtual-key-handoff-failed")).not.toBeInTheDocument();
    });
  });

  describe("when handing the minted key over throws", () => {
    /** @scenario A minted key whose handoff throws offers Show key, never another create */
    it("says the key was created, locks the form and disables Create", async () => {
      handoffThrowsOnce();
      renderMintingDrawer();

      await createWithName();

      const banner = await screen.findByTestId("gateway-virtual-key-handoff-failed");
      expect(banner.textContent).toContain(
        "Virtual key created, but we couldn't finish opening it.",
      );
      expect(banner.textContent).toContain("You don't need to create another one.");
      expect(screen.getByRole("button", { name: "Show key" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
      expect(nameInput().closest("[inert]")).not.toBeNull();
      expect(host.recording.failures).toHaveLength(0);
      expect(createMutateAsync).toHaveBeenCalledTimes(1);
    });

    /** @scenario Show key hands the same minted key over again */
    it("hands the same key over when Show key is pressed, then closes once", async () => {
      handoffThrowsOnce();
      renderMintingDrawer();
      await createWithName();

      await userEvent.click(await screen.findByRole("button", { name: "Show key" }));

      await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2));
      expect(onCreated.mock.calls[1]?.[0]).toEqual(onCreated.mock.calls[0]?.[0]);
      expect(onCreated.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({ id: "vk-new", name: "test-key", secret: SECRET }),
      );
      expect(onOpenChange).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByTestId("gateway-virtual-key-handoff-failed")).not.toBeInTheDocument();
      expect(createMutateAsync).toHaveBeenCalledTimes(1);
    });

    /** @scenario A second handoff failure keeps the recovery open */
    it("keeps offering Show key when the handoff throws again", async () => {
      handoffThrowsOnce();
      handoffThrowsOnce();
      renderMintingDrawer();
      await createWithName();

      await userEvent.click(await screen.findByRole("button", { name: "Show key" }));

      await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2));
      expect(screen.getByTestId("gateway-virtual-key-handoff-failed")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show key" })).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    /** @scenario Escape and Cancel do not discard a key that is still to be shown */
    it("does not close on Escape, and Cancel cannot be pressed", async () => {
      handoffThrowsOnce();
      renderMintingDrawer();
      await createWithName();
      await screen.findByTestId("gateway-virtual-key-handoff-failed");

      await userEvent.keyboard("{Escape}");
      fireEvent.keyDown(document.body, { key: "Escape" });

      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByTestId("gateway-virtual-key-handoff-failed")).toBeInTheDocument();
    });

    /** @scenario Recovery feedback never carries the secret */
    it("puts the secret in no notice and in no text of the drawer", async () => {
      handoffThrowsOnce();
      renderMintingDrawer();
      await createWithName();
      await screen.findByTestId("gateway-virtual-key-handoff-failed");

      expect(JSON.stringify(host.recording)).not.toContain(SECRET);
      expect(document.body.textContent).not.toContain(SECRET);
    });
  });

  describe("when the form will not close after the handoff", () => {
    /** @scenario A form that will not close after the handoff does not hand the key over again */
    it("offers Close only and never hands the key over a second time", async () => {
      onOpenChange.mockImplementationOnce(() => {
        throw new Error("could not close");
      });
      renderMintingDrawer();
      await createWithName();

      const banner = await screen.findByTestId("gateway-virtual-key-close-failed");
      expect(banner.textContent).toContain("Virtual key created, but we couldn't close this form.");
      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();

      await userEvent.click(within(banner).getByRole("button", { name: "Close" }));

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledTimes(2));
      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(createMutateAsync).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("gateway-virtual-key-close-failed")).not.toBeInTheDocument();
    });
  });

  describe("when Create is pressed twice before the first answer", () => {
    /** @scenario A second submit while one is unfinished mints once */
    it("makes the create request once", async () => {
      createMutateAsync.mockReturnValue(new Promise(() => undefined));
      renderMintingDrawer();
      await userEvent.type(nameInput(), "test-key");

      await userEvent.dblClick(screen.getByRole("button", { name: "Create" }));

      expect(createMutateAsync).toHaveBeenCalledTimes(1);
    });
  });
});
