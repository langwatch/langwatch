/**
 * @vitest-environment jsdom
 *
 * The routing policy editor is URL-routed like every other drawer (see
 * dev/docs/best_practices/drawers.md). The page opens it through `openDrawer`
 * so the policy being edited lives in the URL, and the registered drawer
 * rebuilds itself from those params alone, so a pasted link reopens the same
 * policy.
 *
 * Spec: specs/ai-gateway/governance/admin-routing-policies.feature
 *       (Rule: The routing policy editor opens from its own address)
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOpenDrawer, mockCloseDrawer, policies, organization } = vi.hoisted(
  () => ({
    mockOpenDrawer: vi.fn(),
    mockCloseDrawer: vi.fn(),
    organization: {
      id: "org-1",
      name: "ACME",
      teams: [
        {
          id: "team-1",
          name: "Platform",
          projects: [{ id: "proj-1", name: "Web App" }],
        },
      ],
    },
    policies: [
      {
        id: "rp-1",
        name: "Developer default",
        description: null,
        isDefault: true,
        modelProviderIds: ["mp-openai"],
        modelAliases: { complex: "anthropic/claude-opus-4-5" },
        defaultModel: "openai/gpt-5-mini",
        policyRules: { tools: { deny: ["^shell_.*"], allow: null } } as Record<
          string,
          { deny: string[]; allow: string[] | null }
        >,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
      },
    ],
  }),
);

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: mockCloseDrawer,
    goBack: vi.fn(),
    canGoBack: false,
    drawerOpen: vi.fn(() => false),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", teamId: "team-1", slug: "web-app" },
    organization,
  }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/components/settings/ScopeChipPicker", () => ({
  ScopeChipPicker: () => <div data-testid="scope-chip-picker" />,
}));

vi.mock("~/components/settings/ProviderScopeChips", () => ({
  ProviderScopeChips: () => <div data-testid="provider-scope-chips" />,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      routingPolicy: { list: { invalidate: vi.fn() } },
    }),
    routingPolicy: {
      list: { useQuery: () => ({ data: policies, isLoading: false }) },
      get: { useQuery: () => ({ data: policies[0], isLoading: false }) },
      tierSuggestions: {
        useQuery: () => ({
          data: [
            {
              modelId: "anthropic/claude-opus-4-5",
              name: "Claude Opus 4.5",
              provider: "anthropic",
              recommended: true,
            },
          ],
          isLoading: false,
        }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setDefault: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    modelProvider: {
      listAllForOrganizationForFrontend: {
        useQuery: () => ({
          data: {
            providers: [
              {
                id: "mp-openai",
                name: "ACME OpenAI",
                provider: "openai",
                disabledAt: null,
                healthStatus: "HEALTHY",
              },
              {
                id: "mp-anthropic",
                name: "ACME Anthropic",
                provider: "anthropic",
                disabledAt: null,
                healthStatus: "HEALTHY",
              },
            ],
          },
          isLoading: false,
        }),
      },
    },
  },
}));

import { RoutingPolicyDrawer } from "~/components/settings/governance/routingPolicies/RoutingPolicyDrawer";
import { RoutingPoliciesPage } from "../routing-policies";

const renderWithChakra = (ui: React.ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);

/** The Restrictions accordion trigger, whose aria-expanded is the real state. */
const restrictionsTrigger = () =>
  screen.getByText("Restrictions").closest("button");

describe("given the routing policies page", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  describe("when an admin picks Edit from a policy's actions", () => {
    /** @scenario "Editing a policy from the list opens the editor for that policy" */
    it("routes to the editor carrying the policy", async () => {
      const user = userEvent.setup();
      renderWithChakra(<RoutingPoliciesPage />);

      await user.click(
        screen.getByRole("button", { name: "Actions for Developer default" }),
      );
      await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

      expect(mockOpenDrawer).toHaveBeenCalledWith("routingPolicy", {
        policyId: "rp-1",
      });
    });
  });

  describe("when an admin starts a new policy at a scope", () => {
    it("routes to the editor carrying the scope to seed", async () => {
      const user = userEvent.setup();
      renderWithChakra(<RoutingPoliciesPage />);

      await user.click(
        screen.getAllByRole("button", { name: /New policy/ })[0]!,
      );

      expect(mockOpenDrawer).toHaveBeenCalledWith("routingPolicy", {
        seedScopeType: "ORGANIZATION",
        seedScopeId: "org-1",
        seedIsDefault: "false",
      });
    });
  });
});

describe("given a shared link that carries a policy", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  /** @scenario "Editing a policy from the list opens the editor for that policy" */
  it("rebuilds the editor for that policy from the address alone", async () => {
    renderWithChakra(<RoutingPolicyDrawer policyId="rp-1" />);

    expect(await screen.findByText("Edit routing policy")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Developer default")).toBeInTheDocument();
    // The tier the policy stores is shown as a tier, not as a name mapping.
    expect(screen.getByLabelText("Model for the complex tier")).toHaveValue(
      "anthropic/claude-opus-4-5",
    );
    expect(screen.getByDisplayValue("openai/gpt-5-mini")).toBeInTheDocument();
  });

  // The rules arrive with the form reset that follows the policy query, which
  // is after the first render. An uncontrolled accordion would still be closed
  // over them, which is the footgun collapsing is meant to avoid.
  //
  // Asserts the expansion state, not the presence of the content: Chakra keeps
  // a closed accordion's content mounted, so querying for the rule text passes
  // just as happily when the section is shut.
  it("opens Restrictions for a policy that already has rules", async () => {
    renderWithChakra(<RoutingPolicyDrawer policyId="rp-1" />);

    await screen.findByText("Edit routing policy");
    await waitFor(() => {
      expect(restrictionsTrigger()).toHaveAttribute("aria-expanded", "true");
    });
    expect(screen.getByText("1 rule")).toBeInTheDocument();
    expect(screen.getByDisplayValue("^shell_.*")).toBeInTheDocument();
  });

  it("leaves Restrictions closed for a policy with no rules", async () => {
    policies[0]!.policyRules = {};
    try {
      renderWithChakra(<RoutingPolicyDrawer policyId="rp-1" />);
      await screen.findByText("Edit routing policy");
      expect(restrictionsTrigger()).toHaveAttribute("aria-expanded", "false");
    } finally {
      policies[0]!.policyRules = {
        tools: { deny: ["^shell_.*"], allow: null },
      };
    }
  });

  it("offers no Cancel button, because the drawer's close already cancels", async () => {
    renderWithChakra(<RoutingPolicyDrawer policyId="rp-1" />);

    await screen.findByText("Edit routing policy");
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "A tier name cannot be set twice" */
  it("refuses to save a name mapping that reuses a reserved tier name", async () => {
    const user = userEvent.setup();
    renderWithChakra(<RoutingPolicyDrawer policyId="rp-1" />);

    await screen.findByText("Edit routing policy");
    await user.click(screen.getByRole("button", { name: /Add mapping/ }));
    await user.type(screen.getByLabelText("Requested model name 1"), "fast");

    await waitFor(() => {
      expect(screen.getByText(/is a model tier/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
