/**
 * @vitest-environment jsdom
 *
 * The create drawer in an organization with no projects. The ownership
 * seed effect has nothing to seed here; before the identity guard it
 * produced a fresh but value-identical state object on every pass and
 * re-armed itself, spinning the drawer at 100% CPU. Rendering in this
 * state is the revert-proof for that guard: without it, React aborts
 * with a maximum-update-depth error and this suite fails.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VirtualKeyCreateDrawer } from "../ui/sections/virtual-key-create-drawer";

const ORG_ID = "org-empty";
const USER_ID = "user-1";

vi.mock("../../../behavior/gateway-api", () => ({
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
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
      applicableBudgets: {
        useQuery: () => ({ data: [] }),
      },
    },
    modelProvider: {
      listAllForOrganizationForFrontend: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
    routingPolicy: {
      list: { useQuery: () => ({ data: [] }) },
    },
    user: {
      personalContext: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

/**
 * The freshest possible organization: no teams and no projects. With nothing to
 * seed, both seed values stay null; only the identity guard keeps the seed
 * effect from re-arming forever.
 */
const host = fakeGatewayHost({
  permissions: ["virtualKeys:manage"],
  organization: { id: ORG_ID, name: "Empty Org", slug: "empty-org", teams: [] },
  project: null,
  currentUser: { id: USER_ID, name: "Ada", email: "ada@acme.test" },
});


describe("given an organization with no projects", () => {
  afterEach(() => cleanup());

  it("renders the drawer without looping and keeps Create disabled", async () => {
    renderWithGatewayHost(
      <VirtualKeyCreateDrawer
        organizationId={ORG_ID}
        open
        onOpenChange={() => undefined}
        onCreated={() => undefined}
      />,
      { host },
    );

    await waitFor(() => {
      expect(screen.getByText("New virtual key")).toBeInTheDocument();
    });
    // Create stays disabled: with nothing typed the first unmet
    // requirement is the name, and even a named draft would still lack a
    // project for its traces to land in.
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });
});
