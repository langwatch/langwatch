/**
 * @vitest-environment jsdom
 *
 * A budget on a scope no active key can reach is refused, and the refusal
 * offers a way through: "Create it anyway", which resubmits the form with
 * `allowUnreachable`. That override is an answer to one question, about the
 * scope the server actually refused, so it must not survive the form being
 * pointed at a different one.
 *
 * Spec: specs/ai-gateway/gateway-budget-targeting.feature
 */
import { cleanup, screen, waitFor } from "@testing-library/react";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BudgetCreateDrawer } from "../ui/sections/budget-create-drawer";

const ORG_ID = "org-acme";
const TEAM_ID = "team-platform";
const PROJECT_ID = "project-web-app";
const OTHER_PROJECT_ID = "project-batch";

const { createMutateAsync } = vi.hoisted(() => ({
  createMutateAsync: vi.fn(),
}));

vi.mock("../../../behavior/gateway-api", () => ({
  api: {
    useUtils: () => ({
      gatewayBudgets: {
        list: { invalidate: async () => undefined },
        listForProject: { invalidate: async () => undefined },
      },
    }),
    gatewayBudgets: {
      create: {
        useMutation: () => ({
          mutateAsync: createMutateAsync,
          isPending: false,
        }),
      },
      groupTargets: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    virtualKeys: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
    organization: {
      getAllOrganizationMembers: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
    modelProvider: {
      listAllForOrganizationForFrontend: {
        useQuery: () => ({ data: [] }),
      },
    },
  },
}));

/** One organization with a team and two projects, and an admin looking at it. */
const host = fakeGatewayHost({
  permissions: ["organization:manage"],
  organization: {
    id: ORG_ID,
    name: "ACME",
    slug: "acme",
    teams: [
      {
        id: TEAM_ID,
        name: "platform",
        projects: [
          { id: PROJECT_ID, name: "web-app", slug: "web-app", teamId: TEAM_ID },
          { id: OTHER_PROJECT_ID, name: "batch", slug: "batch", teamId: TEAM_ID },
        ],
      },
    ],
  },
});

/** The tRPC envelope a handled refusal arrives in. */
function unreachableRefusal() {
  return {
    data: {
      error: {
        code: "gateway_budget_scope_unreachable",
        httpStatus: 400,
        fault: "customer",
        meta: { scope_type: "project", reachable_project_ids: [] },
      },
    },
  };
}

function renderDrawer() {
  return renderWithGatewayHost(
    <BudgetCreateDrawer open onOpenChange={() => undefined} onCreated={() => undefined} />,
    { host },
  );
}

/**
 * Fill the form for a project budget and submit it. The target starts
 * unpicked, so it has to be chosen here or submit refuses locally and never
 * reaches the server.
 */
async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId("budget-target"), PROJECT_ID);
  await user.type(
    screen.getByPlaceholderText("e.g. Engineering monthly $1k cap"),
    "Batch cap",
  );
  await user.type(screen.getByPlaceholderText("1000.00"), "50");
  await user.click(screen.getByRole("button", { name: "Create budget" }));
}

describe("BudgetCreateDrawer", () => {
  beforeEach(() => {
    createMutateAsync.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the server refused the scope as unreachable", () => {
    describe("when a different target is picked", () => {
      /** @scenario "The offer to keep an unreachable budget does not follow the form to another scope" */
      it("drops the override rather than applying it to a scope nobody refused", async () => {
        const user = userEvent.setup();
        createMutateAsync.mockRejectedValueOnce(unreachableRefusal());
        renderDrawer();

        await fillAndSubmit(user);
        await waitFor(() => {
          expect(screen.getByTestId("budget-create-anyway")).toBeTruthy();
        });

        await user.selectOptions(screen.getByTestId("budget-target"), OTHER_PROJECT_ID);

        expect(screen.queryByTestId("budget-create-anyway")).toBeNull();
        expect(screen.queryByTestId("budget-submit-error")).toBeNull();

        // And the retry that is no longer offered cannot be reached another
        // way: the plain submit asks about the new scope on its own terms.
        createMutateAsync.mockResolvedValueOnce({ id: "bdg_1" });
        await user.click(screen.getByRole("button", { name: "Create budget" }));
        await waitFor(() => {
          expect(createMutateAsync).toHaveBeenCalledTimes(2);
        });
        expect(createMutateAsync.mock.calls[1]![0]).toMatchObject({
          scope: { kind: "PROJECT", projectId: OTHER_PROJECT_ID },
          allowUnreachable: undefined,
        });
      });
    });

    describe("when the same target is kept", () => {
      it("keeps the override, and sends it with the scope that was refused", async () => {
        const user = userEvent.setup();
        createMutateAsync.mockRejectedValueOnce(unreachableRefusal());
        renderDrawer();

        await fillAndSubmit(user);
        await waitFor(() => {
          expect(screen.getByTestId("budget-create-anyway")).toBeTruthy();
        });

        createMutateAsync.mockResolvedValueOnce({ id: "bdg_1" });
        await user.click(screen.getByTestId("budget-create-anyway"));

        await waitFor(() => {
          expect(createMutateAsync).toHaveBeenCalledTimes(2);
        });
        expect(createMutateAsync.mock.calls[1]![0]).toMatchObject({
          scope: { kind: "PROJECT", projectId: PROJECT_ID },
          allowUnreachable: true,
        });
      });
    });
  });
});
