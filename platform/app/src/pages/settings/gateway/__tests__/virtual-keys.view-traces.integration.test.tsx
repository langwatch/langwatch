/**
 * @vitest-environment jsdom
 *
 * "View traces" is only worth offering when the link leads somewhere: the key
 * has a trace destination, that project still exists, and the viewer belongs
 * to a team that holds it. The row action is rendered over the real page so
 * the gate is observed where a customer meets it, not on a helper in
 * isolation.
 *
 * Real component tree, network boundary mocked.
 *
 * Spec: specs/ai-gateway/virtual-keys.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "org-acme";
const TEAM_ID = "team-platform";
const PROJECT_ID = "project-web-app";
const PROJECT_SLUG = "web-app";
const VK_ID = "vk-billing";

type VirtualKeyRow = {
  id: string;
  name: string;
  status: string;
  displayPrefix: string;
  scopes: Array<{ scopeType: string; scopeId: string }>;
  routingMode: string;
  routingPolicyId: string | null;
  traceProjectId: string | null;
  traceProjectArchived: boolean;
  lastUsedAt: string | null;
  principalUserId: string | null;
  principalUser: null;
  config: Record<string, unknown>;
};

const { listRows, routerPush } = vi.hoisted(() => ({
  listRows: { value: [] as VirtualKeyRow[] },
  routerPush: vi.fn(),
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
          projects: [{ id: PROJECT_ID, name: "web-app", slug: PROJECT_SLUG }],
        },
      ],
    },
    hasPermission: () => true,
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/settings/gateway/virtual-keys",
    push: routerPush,
    replace: vi.fn(),
  }),
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard:
    () =>
    <P extends object>(Component: (props: P) => ReactNode) =>
    (props: P) =>
      Component(props),
}));

vi.mock("~/components/gateway/AiGatewayLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// The drawers the page keeps mounted have their own network surface, none of
// which the row action touches.
vi.mock("~/components/gateway/VirtualKeyCreateDrawer", () => ({
  VirtualKeyCreateDrawer: () => null,
}));
vi.mock("~/components/gateway/VirtualKeyEditDrawer", () => ({
  VirtualKeyEditDrawer: () => null,
}));
vi.mock("~/components/gateway/VirtualKeySecretReveal", () => ({
  VirtualKeySecretReveal: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      virtualKeys: { list: { invalidate: async () => undefined } },
    }),
    virtualKeys: {
      list: { useQuery: () => ({ data: listRows.value, isLoading: false }) },
      spendThisMonth: {
        useQuery: () => ({ data: [], isLoading: false, isError: false }),
      },
      rotate: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      revoke: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
    routingPolicy: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

import VirtualKeysPage from "../virtual-keys";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function keyRow(overrides: Partial<VirtualKeyRow> = {}): VirtualKeyRow {
  return {
    id: VK_ID,
    name: "Billing tenant",
    status: "active",
    displayPrefix: "vk-lw-abc",
    scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
    routingMode: "NONE",
    routingPolicyId: null,
    traceProjectId: PROJECT_ID,
    traceProjectArchived: false,
    lastUsedAt: null,
    principalUserId: null,
    principalUser: null,
    config: {},
    ...overrides,
  };
}

async function openRowActions() {
  render(<VirtualKeysPage />, { wrapper: Wrapper });
  await userEvent.click(screen.getByRole("button", { name: "Actions" }));
  await screen.findByText("Details");
}

describe("View traces row action", () => {
  beforeEach(() => {
    routerPush.mockReset();
    listRows.value = [keyRow()];
  });

  afterEach(cleanup);

  describe("given a key whose trace destination is live and reachable", () => {
    describe("when View traces is chosen from the row actions", () => {
      /** @scenario View traces opens the key's destination filtered to that key */
      it("navigates to the destination's trace explorer filtered to the key", async () => {
        await openRowActions();

        await userEvent.click(screen.getByText("View traces"));

        expect(routerPush).toHaveBeenCalledTimes(1);
        const href = String(routerPush.mock.calls[0]?.[0]);
        expect(href.startsWith(`/${PROJECT_SLUG}/traces#all-traces?`)).toBe(
          true,
        );
        expect(href).toContain(encodeURIComponent(`"${VK_ID}"`));
      });
    });
  });

  describe("given a key with no trace destination", () => {
    describe("when the row actions are opened", () => {
      /** @scenario View traces is absent when the key has no trace destination */
      it("offers no View traces action", async () => {
        listRows.value = [keyRow({ traceProjectId: null })];

        await openRowActions();

        expect(screen.queryByText("View traces")).toBeNull();
      });
    });
  });

  describe("given a key whose trace destination was deleted", () => {
    describe("when the row actions are opened", () => {
      /** @scenario View traces is absent when the trace destination was deleted */
      it("offers no View traces action", async () => {
        listRows.value = [keyRow({ traceProjectArchived: true })];

        await openRowActions();

        expect(screen.queryByText("View traces")).toBeNull();
      });
    });
  });

  describe("given a destination on a team the viewer does not belong to", () => {
    describe("when the row actions are opened", () => {
      /** @scenario View traces is absent when the destination sits on a team I cannot open */
      it("offers no View traces action", async () => {
        listRows.value = [keyRow({ traceProjectId: "project-elsewhere" })];

        await openRowActions();

        expect(screen.queryByText("View traces")).toBeNull();
      });
    });
  });
});
