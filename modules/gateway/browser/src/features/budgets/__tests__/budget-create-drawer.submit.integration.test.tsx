/**
 * @vitest-environment jsdom
 * Characterizes creating a budget: local refusals, what submit sends, and scope seeding.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing.tsx";
import { BudgetCreateDrawer } from "../ui/sections/budget-create-drawer.tsx";

const ORG_ID = "org-acme";
const TEAM_ID = "team-platform";
const PROJECT_ID = "project-web-app";

const { createMutateAsync } = vi.hoisted(() => ({ createMutateAsync: vi.fn() }));

vi.mock("../../../behavior/gateway-api.ts", () => ({
  api: {
    useUtils: () => ({
      gatewayBudgets: {
        list: { invalidate: async () => undefined },
        listForProject: { invalidate: async () => undefined },
      },
    }),
    gatewayBudgets: {
      create: { useMutation: () => ({ mutateAsync: createMutateAsync, isPending: false }) },
      groupTargets: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    virtualKeys: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
    organization: {
      getAllOrganizationMembers: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    modelProvider: { listAllForOrganizationForFrontend: { useQuery: () => ({ data: [] }) } },
  },
}));

const PROJECT = { id: PROJECT_ID, name: "web-app", slug: "web-app", teamId: TEAM_ID };

function renderDrawer() {
  const host = fakeGatewayHost({
    permissions: ["organization:manage"],
    organization: {
      id: ORG_ID,
      name: "ACME",
      slug: "acme",
      teams: [{ id: TEAM_ID, name: "platform", projects: [PROJECT] }],
    },
    project: PROJECT,
  });
  const onCreated = vi.fn();
  renderWithGatewayHost(
    <BudgetCreateDrawer open onOpenChange={() => undefined} onCreated={onCreated} />,
    { host },
  );
  return { host, onCreated };
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  input: { name: string; limit: string },
) {
  if (input.name) {
    await user.type(screen.getByPlaceholderText("e.g. Engineering monthly $1k cap"), input.name);
  }
  if (input.limit) await user.type(screen.getByPlaceholderText("1000.00"), input.limit);
}

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Create budget" }));

beforeEach(() => createMutateAsync.mockReset());
afterEach(() => cleanup());

describe("BudgetCreateDrawer submit", () => {
  describe("when the name is missing", () => {
    it("keeps the create button disabled", async () => {
      const user = userEvent.setup();
      renderDrawer();
      await fill(user, { name: "", limit: "50" });

      expect(screen.getByRole("button", { name: "Create budget" })).toHaveProperty(
        "disabled",
        true,
      );
      expect(createMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe("when the limit is not positive", () => {
    it("refuses with a toast and sends nothing", async () => {
      const user = userEvent.setup();
      const { host } = renderDrawer();
      await fill(user, { name: "Cap", limit: "0" });
      await submit(user);

      expect(host.recording.failures.map((f) => f.fallbackTitle)).toEqual([
        "Limit must be a positive number",
      ]);
      expect(createMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe("when no target is picked", () => {
    it("asks for one inline and sends nothing", async () => {
      const user = userEvent.setup();
      renderDrawer();
      await fill(user, { name: "Cap", limit: "50" });
      await submit(user);

      expect(screen.getByTestId("budget-submit-error").textContent).toContain(
        "Pick what this budget applies to.",
      );
      expect(createMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe("when the organization is the scope", () => {
    it("creates the budget with no target and reports it created", async () => {
      const user = userEvent.setup();
      createMutateAsync.mockResolvedValueOnce({ id: "bdg_1" });
      const { onCreated } = renderDrawer();
      await user.click(screen.getByText("Organization"));
      await fill(user, { name: "Cap", limit: "50" });
      await submit(user);

      await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
      expect(createMutateAsync.mock.calls[0]![0]).toMatchObject({
        organizationId: ORG_ID,
        name: "Cap",
        limitUsd: "50",
        window: "MONTH",
        onBreach: "BLOCK",
        providerKey: null,
        cycleAnchorAt: null,
      });
    });
  });

  describe("when a scope kind is picked", () => {
    it("seeds the target from the current team or project, and clears it otherwise", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.click(screen.getByText("Team"));
      expect(screen.getByTestId("budget-target")).toHaveProperty("value", TEAM_ID);
      await user.click(screen.getByText("Project"));
      expect(screen.getByTestId("budget-target")).toHaveProperty("value", PROJECT_ID);
      await user.click(screen.getByText("Member"));
      expect(screen.getByTestId("budget-target")).toHaveProperty("value", "");
    });
  });
});
