/**
 * @vitest-environment jsdom
 *
 * The edit drawer must read back exactly what a key is (its routing
 * mode, its budget, its provider allowlist) and persist only what the
 * user changed. The sharp edges pinned here: an existing key's routing
 * choice survives an unrelated edit (nothing changes under a customer),
 * clearing the budget field archives the key's cap, and the key's own
 * budget is presented in the field rather than listed twice.
 *
 * Real component tree, network boundary mocked.
 *
 * Spec: specs/ai-gateway/virtual-key-creation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VirtualKeyEditDrawer } from "../VirtualKeyEditDrawer";

const ORG_ID = "org-acme";
const TEAM_ID = "team-platform";
const PROJECT_ID = "project-web-app";
const VK_ID = "vk-legacy";

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

const { updateMutateAsync, applicableBudgetsData } = vi.hoisted(() => ({
  updateMutateAsync: vi.fn(),
  applicableBudgetsData: { rows: [] as ApplicableBudget[] },
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
          projects: [{ id: PROJECT_ID, name: "web-app", slug: "web-app" }],
        },
      ],
    },
    team: { id: TEAM_ID, name: "platform" },
    project: { id: PROJECT_ID, name: "web-app" },
    hasPermission: () => true,
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
      update: {
        useMutation: () => ({
          mutateAsync: updateMutateAsync,
          isPending: false,
        }),
      },
      applicableBudgets: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => ({
          data:
            opts?.enabled === false ? undefined : applicableBudgetsData.rows,
        }),
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
  },
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const baseVk = {
  id: VK_ID,
  organizationId: ORG_ID,
  name: "legacy-key",
  description: null,
  status: "active" as const,
  scopes: [{ scopeType: "PROJECT" as const, scopeId: PROJECT_ID }],
  routingPolicyId: null as string | null,
  routingMode: "FALLBACK_ALL" as "NONE" | "FALLBACK_ALL" | "POLICY",
  principalUserId: null,
  principalUser: null,
  config: {},
};

const renderDrawer = (vk: Partial<typeof baseVk> & Record<string, any> = {}) =>
  render(
    <VirtualKeyEditDrawer
      organizationId={ORG_ID}
      vk={{ ...baseVk, ...vk }}
      onOpenChange={() => undefined}
      onSaved={() => undefined}
    />,
    { wrapper: Wrapper },
  );

const lastUpdateInput = (): Record<string, any> => {
  const call = updateMutateAsync.mock.calls.at(-1);
  if (!call) throw new Error("update was never called");
  return call[0] as Record<string, any>;
};

const save = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled());
};

const ownBudgetRow = (
  overrides: Partial<ApplicableBudget> = {},
): ApplicableBudget => ({
  id: "budget-own",
  name: "legacy-key budget",
  scopeType: "VIRTUAL_KEY",
  scopeId: VK_ID,
  scopeLabel: "legacy-key",
  window: "DAY",
  limitUsd: "5.000000",
  spentUsd: "1.25",
  onBreach: "BLOCK",
  timezone: "Europe/Amsterdam",
  providerKey: null,
  providerLabel: null,
  isPerMember: false,
  // The row the drawer's own field manages; the seeding effect finds it
  // by this linkage, never by shape.
  managedByVirtualKeyId: VK_ID,
  ...overrides,
});

describe("given the edit drawer for an existing key", () => {
  beforeEach(() => {
    updateMutateAsync.mockReset();
    updateMutateAsync.mockResolvedValue({ id: VK_ID });
    applicableBudgetsData.rows = [];
  });

  afterEach(() => cleanup());

  describe("when the key predates the routing choice and was pinned to fall back", () => {
    it("shows fallback-to-all selected and keeps it on an unrelated edit", async () => {
      renderDrawer({ routingMode: "FALLBACK_ALL", routingPolicyId: null });

      await waitFor(() => {
        expect(
          screen
            .getByTestId("vk-routing-fallback-all")
            .querySelector("input[type=radio]"),
        ).toBeChecked();
      });

      await save();
      expect(lastUpdateInput().routingMode).toBe("FALLBACK_ALL");
      expect(lastUpdateInput().routingPolicyId).toBeNull();
    });
  });

  describe("when the key explicitly does not fall back", () => {
    it("shows no-fallback selected and keeps it", async () => {
      renderDrawer({ routingMode: "NONE", routingPolicyId: null });

      await waitFor(() => {
        expect(
          screen
            .getByTestId("vk-routing-none")
            .querySelector("input[type=radio]"),
        ).toBeChecked();
      });

      await save();
      expect(lastUpdateInput().routingMode).toBe("NONE");
    });
  });

  describe("when the key carries a budget", () => {
    it("prefills the field and the period, and states the UTC reset regardless of any stored timezone", async () => {
      // The row carries a timezone (settable over the API), but resets
      // are computed in UTC only, so the annotation must not promise it.
      applicableBudgetsData.rows = [ownBudgetRow()];
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("vk-budget-limit")).toHaveValue("5");
      });
      expect(screen.getByTestId("vk-budget-window")).toHaveValue("DAY");
      expect(screen.getByTestId("vk-budget-annotation").textContent).toBe(
        "Max $5/day, resets 00:00 UTC",
      );
    });

    it("does not list the key's own budget under already-applies", async () => {
      applicableBudgetsData.rows = [
        ownBudgetRow(),
        ownBudgetRow({
          id: "budget-org",
          scopeType: "ORGANIZATION",
          scopeId: ORG_ID,
          scopeLabel: "ACME",
          window: "MONTH",
          limitUsd: "1000",
          timezone: null,
          managedByVirtualKeyId: null,
        }),
      ];
      renderDrawer();

      const list = await screen.findByTestId("vk-applicable-budgets");
      expect(list.textContent).toContain("ACME");
      expect(list.textContent).not.toContain("legacy-key budget");
    });

    /** @scenario Removing a key's budget from the drawer archives it */
    it("clearing the field saves null, the archive-my-budget signal", async () => {
      applicableBudgetsData.rows = [ownBudgetRow()];
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("vk-budget-limit")).toHaveValue("5");
      });
      await userEvent.clear(screen.getByTestId("vk-budget-limit"));
      expect(screen.getByTestId("vk-budget-annotation").textContent).toContain(
        "No max spending for this key",
      );

      await save();
      expect(lastUpdateInput().budget).toBeNull();
    });
  });

  describe("when the key never had a budget and the field stays empty", () => {
    it("leaves the budget out of the update entirely", async () => {
      renderDrawer();

      await save();
      expect(lastUpdateInput().budget).toBeUndefined();
    });
  });

  describe("when the key has an explicit provider allowlist", () => {
    it("shows exactly those providers checked and persists an edit to them", async () => {
      renderDrawer({
        config: { providersAllowed: ["mp-openai"], modelsAllowed: null },
      });

      await waitFor(() => {
        expect(
          screen
            .getByTestId("vk-providers-all")
            .querySelector("input[type=checkbox]"),
        ).not.toBeChecked();
      });
      expect(
        screen
          .getByTestId("vk-provider-mp-openai")
          .querySelector("input[type=checkbox]"),
      ).toBeChecked();
      expect(
        screen
          .getByTestId("vk-provider-mp-anthropic")
          .querySelector("input[type=checkbox]"),
      ).not.toBeChecked();

      await userEvent.click(screen.getByTestId("vk-provider-mp-anthropic"));
      await save();
      expect([...lastUpdateInput().config.providersAllowed].sort()).toEqual([
        "mp-anthropic",
        "mp-openai",
      ]);
    });
  });

  describe("when the key allows every provider", () => {
    it("keeps persisting the absence of a list on unrelated edits", async () => {
      renderDrawer({ config: {} });

      await waitFor(() =>
        expect(
          screen
            .getByTestId("vk-providers-all")
            .querySelector("input[type=checkbox]"),
        ).toBeChecked(),
      );
      await save();
      expect(lastUpdateInput().config.providersAllowed).toBeNull();
    });
  });

  describe("when the key's traces land in a project the viewer can open", () => {
    it("offers the trace destination's traces next to where they land", async () => {
      renderDrawer({ traceProjectId: PROJECT_ID, traceProjectArchived: false });

      const href = await waitFor(() =>
        screen.getByTestId("vk-view-traces").closest("a")?.getAttribute("href"),
      );
      expect(href?.startsWith("/web-app/traces#all-traces?")).toBe(true);
      expect(href).toContain(encodeURIComponent(`"${VK_ID}"`));
    });
  });

  describe("when the project the key traces into was deleted", () => {
    it("keeps the Deleted badge and offers no way to open its traces", async () => {
      renderDrawer({ traceProjectId: PROJECT_ID, traceProjectArchived: true });

      await waitFor(() =>
        expect(screen.getByTestId("vk-trace-destination-deleted")).toBeTruthy(),
      );
      expect(screen.queryByTestId("vk-view-traces")).toBeNull();
    });
  });

  describe("when the key carries an expiration date", () => {
    /** @scenario "The edit drawer round-trips the stored date" */
    it("shows the stored day and sends no date back untouched", async () => {
      renderDrawer({ expiresAt: "2030-08-20T09:15:00.000Z" });

      await waitFor(() =>
        expect(
          (screen.getByTestId("vk-expiration-preset") as HTMLSelectElement)
            .value,
        ).toBe("custom"),
      );
      expect(
        (screen.getByTestId("vk-expiration-date") as HTMLInputElement).value,
      ).toBe("2030-08-20");

      await save();
      // Untouched means untouched: the field is left out, so the stored
      // instant stays exactly where it is. Re-resolving the day would
      // push the key's last minutes to the end of that day instead.
      expect("expiresAt" in lastUpdateInput()).toBe(false);
    });

    /** @scenario "An expired key can still be edited so the date can be extended" */
    it("leaves a passed date out, so an unrelated edit to an expired key saves", async () => {
      renderDrawer({ expiresAt: "2020-01-01T00:00:00.000Z" });

      const nameInput = await waitFor(() =>
        screen.getByDisplayValue("legacy-key"),
      );
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, "renamed-key");

      await save();
      // A resent past date fails the server's future-date check, which
      // would make renaming an expired key impossible.
      expect("expiresAt" in lastUpdateInput()).toBe(false);
      expect(lastUpdateInput().name).toBe("renamed-key");
    });

    it("clears the date when the choice moves back to Never", async () => {
      renderDrawer({ expiresAt: "2030-08-20T09:15:00.000Z" });

      await waitFor(() =>
        expect(screen.getByTestId("vk-expiration-preset")).toBeTruthy(),
      );
      await userEvent.selectOptions(
        screen.getByTestId("vk-expiration-preset"),
        "",
      );
      await save();
      expect(lastUpdateInput().expiresAt).toBeNull();
    });

    it("moves the date when a new day is typed", async () => {
      renderDrawer({ expiresAt: "2030-08-20T09:15:00.000Z" });

      const dateInput = await waitFor(() =>
        screen.getByTestId("vk-expiration-date"),
      );
      await userEvent.clear(dateInput);
      await userEvent.type(dateInput, "2030-09-01");
      await save();
      expect((lastUpdateInput().expiresAt as Date).toISOString()).toBe(
        "2030-09-01T23:59:59.999Z",
      );
    });
  });

  describe("when the key never expires", () => {
    it("reads back as Never and keeps sending no date", async () => {
      renderDrawer({ expiresAt: null });

      await waitFor(() =>
        expect(
          (screen.getByTestId("vk-expiration-preset") as HTMLSelectElement)
            .value,
        ).toBe(""),
      );
      await save();
      expect("expiresAt" in lastUpdateInput()).toBe(false);
    });
  });
});
