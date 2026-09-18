/**
 * @vitest-environment jsdom
 * Readers with read-only grant see all policies but no authoring controls.
 * Spec: specs/ai-governance/rbac/delegated-governance-viewer.feature
 */
import { cleanup, screen } from "@testing-library/react";
import type React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../../testing.tsx";

vi.mock("../../../../ui/sections/gateway-layout.tsx", () => ({
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

vi.mock("../../../../behavior/gateway-api.ts", () => {
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

import RoutingPoliciesPage from "../gateway-routing-policies.screen.tsx";

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
      expect(screen.queryByRole("button", { name: /New policy/ })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Actions for House default/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/routingPolicies:manage/)).toBeInTheDocument();
    });
  });

  describe("when the viewer holds routingPolicies:manage", () => {
    it("offers the authoring controls", () => {
      renderPage(["organization:view", "routingPolicies:manage"]);

      expect(screen.getAllByRole("button", { name: /New policy/ }).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: /Actions for House default/ })).toBeInTheDocument();
      expect(screen.queryByText(/routingPolicies:manage/)).not.toBeInTheDocument();
    });
  });
});
