/**
 * @vitest-environment jsdom
 *
 * `/gateway/routing-policies` is reached from the Gateway section navigation,
 * which is offered on `virtualKeys:view`. Its router reads on
 * `routingPolicies:view` and writes on `routingPolicies:manage`, the same
 * split every sibling Gateway page gates on, but the page guard used to ask
 * for `organization:manage` - so a team member holding `routingPolicies:view`
 * was offered the menu entry and refused the page.
 *
 * The page now opens on the read grant and the authoring controls appear only
 * for the write one. The real `withPermissionGuard` and the real page decide;
 * only the layout, the flag, the drawer, and the tRPC client are mocked.
 *
 * Spec: specs/ai-governance/rbac/delegated-governance-viewer.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  permissions: [] as string[],
  /** What the policy list answers with instead of rows, when set. */
  listError: null as unknown,
}));

vi.mock("~/hooks/useOrganizationTeamProject", async () => {
  const rbac =
    await vi.importActual<typeof import("@langwatch/authz")>(
      "@langwatch/authz",
    );
  const holds = (permission: string) =>
    rbac.permissionSatisfiedBy({
      granted: new Set(harness.permissions),
      requested: permission,
    });
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("~/components/gateway/AiGatewayLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }),
}));

const POLICIES = [
  {
    id: "rp-1",
    name: "House default",
    description: null,
    isDefault: true,
    modelProviderIds: ["mp-1"],
    modelAliases: {},
    defaultModel: "openai/gpt-5-mini",
    scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
  },
];

vi.mock("~/utils/api", () => {
  const queryResult = (data: unknown) => ({
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  const mutationResult = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined,
  });

  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            const key = path.join(".");
            return () =>
              key === "routingPolicy.list" && harness.listError
                ? {
                    ...queryResult(undefined),
                    isError: true,
                    error: harness.listError,
                  }
                : queryResult(
                    key === "routingPolicy.list" ? POLICIES : undefined,
                  );
          }
          if (property === "useMutation") return mutationResult;
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  return { api: node([]) };
});

import RoutingPoliciesPage from "../routing-policies";

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <RoutingPoliciesPage />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  harness.permissions = [];
  harness.listError = null;
});

afterEach(() => cleanup());

describe("routing policies page access", () => {
  describe("when the server refuses the policy list for a missing grant", () => {
    /** @scenario "A refused policy list reads as no access, not as a failed load" */
    it("names the grant and shows neither a load error nor the table", () => {
      // The page guard passes; the refusal is the server's answer to the list.
      harness.permissions = ["organization:view", "routingPolicies:view"];
      harness.listError = {
        data: {
          code: "FORBIDDEN",
          error: {
            code: "permission_denied",
            httpStatus: 403,
            meta: { permission: "routingPolicies:view" },
          },
        },
      };
      renderPage();

      expect(
        screen.getByText("You don't have permission to do this"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/grant you "routingPolicies:view"/),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Couldn't load routing policies"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("House default")).not.toBeInTheDocument();
      expect(
        screen.queryByText(/You can read the policies/),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the viewer holds routingPolicies:view only", () => {
    /** @scenario "Routing policies opens on the grant its router asks for" */
    it("opens the page, lists the policies, and offers no authoring controls", () => {
      harness.permissions = ["organization:view", "routingPolicies:view"];
      renderPage();

      expect(screen.queryByText("Access Restricted")).not.toBeInTheDocument();
      expect(screen.getByText("House default")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /New policy/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Actions for House default/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/routingPolicies:manage/)).toBeInTheDocument();
    });
  });

  describe("when the viewer holds routingPolicies:manage", () => {
    it("offers the authoring controls", () => {
      harness.permissions = ["organization:view", "routingPolicies:manage"];
      renderPage();

      expect(
        screen.getAllByRole("button", { name: /New policy/ }).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getByRole("button", { name: /Actions for House default/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/routingPolicies:manage/),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the viewer holds neither grant", () => {
    it("is refused", () => {
      harness.permissions = ["organization:view"];
      renderPage();

      expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    });
  });
});
