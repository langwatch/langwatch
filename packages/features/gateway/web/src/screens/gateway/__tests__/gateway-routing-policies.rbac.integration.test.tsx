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
 * for the write one. WHICH GRANT OPENS THE PAGE AT ALL IS NO LONGER THE
 * SCREEN'S: the route table states it and `withUiPageGuard` enforces it, so
 * the refusal half of this rule is pinned in `apps/ui/tests/gateway-routes.unit.test.ts`
 * and what is left here is what the page itself decides — that a reader with
 * only the read grant sees every policy and none of the authoring controls.
 *
 * Only the tRPC client and the section layout are faked; permissions run
 * through the authz contract's own hierarchy rule, so a case cannot pass here
 * by disagreeing with the rule the server applies.
 *
 * Spec: specs/ai-governance/rbac/delegated-governance-viewer.feature
 */
import { cleanup, screen } from "@testing-library/react";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ui/sections/gateway-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
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

vi.mock("../../../behavior/gateway-api", () => {
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
            return () => queryResult(key === "routingPolicy.list" ? POLICIES : undefined);
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

import RoutingPoliciesPage from "../gateway-routing-policies.screen";

function renderPage(permissions: readonly string[]) {
  return renderWithGatewayHost(<RoutingPoliciesPage />, {
    host: fakeGatewayHost({
      permissions,
      organization: { id: "org-1", name: "ACME", slug: "acme", teams: [] },
      project: null,
    }),
  });
}

afterEach(() => cleanup());

describe("routing policies page access", () => {
  describe("when the viewer holds routingPolicies:view only", () => {
    /** @scenario "Routing policies opens on the grant its router asks for" */
    it("opens the page, lists the policies, and offers no authoring controls", () => {
      renderPage(["organization:view", "routingPolicies:view"]);

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
      renderPage(["organization:view", "routingPolicies:manage"]);

      expect(
        screen.getAllByRole("button", { name: /New policy/ }).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getByRole("button", { name: /Actions for House default/ }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/routingPolicies:manage/)).not.toBeInTheDocument();
    });
  });
});
