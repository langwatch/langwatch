/**
 * @vitest-environment jsdom
 *
 * The virtual-key detail page, on the four things it used to get wrong or
 * leave out: when the key expires, where its traces are, what its routing
 * policy is called, and which providers it may actually reach.
 *
 * Real component tree for the parts under test (the eligible-providers
 * panel resolves for real), network boundary mocked.
 *
 * Spec: specs/ai-gateway/virtual-keys.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "org-acme";
const TEAM_ID = "team-platform";
const PROJECT_ID = "project-web-app";
const VK_ID = "vk-detail";

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard:
    () =>
    <P extends object>(Component: React.ComponentType<P>) =>
      Component,
}));

vi.mock("~/components/gateway/AiGatewayLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/components/gateway/VirtualKeyEditDrawer", () => ({
  VirtualKeyEditDrawer: () => null,
}));
vi.mock("~/components/gateway/VirtualKeySecretReveal", () => ({
  VirtualKeySecretReveal: () => null,
}));
vi.mock("~/components/gateway/GuardrailAttachmentsSection", () => ({
  GuardrailAttachmentsSection: () => null,
}));
vi.mock("~/components/gateway/VirtualKeyUsageSnippet", () => ({
  VirtualKeyUsageSnippet: () => null,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: { id: VK_ID }, push: vi.fn() }),
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
    project: undefined,
    hasPermission: () => true,
  }),
}));

const PROVIDERS = [
  {
    id: "mp-openai",
    name: "OpenAI",
    provider: "openai",
    enabled: true,
    disabledAt: null,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
    models: ["gpt-5-mini"],
  },
  {
    id: "mp-anthropic",
    name: "Anthropic",
    provider: "anthropic",
    enabled: true,
    disabledAt: null,
    scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
    models: ["claude-sonnet-4-5"],
  },
];

const { detail, policy, usageInputs } = vi.hoisted(() => ({
  detail: { current: {} as Record<string, unknown> },
  policy: {
    current: { data: undefined as unknown, isError: false },
  },
  usageInputs: [] as Array<Record<string, unknown>>,
}));

const usageSummary = {
  totalUsd: "1.500000",
  totalRequests: 12,
  blockedRequests: 0,
  avgUsdPerRequest: "0.125000",
  byModel: [
    { model: "gpt-5-mini", totalUsd: "1.000000", requests: 8 },
    { model: "claude-sonnet-4-5", totalUsd: "0.500000", requests: 4 },
  ],
  byDay: [{ day: "2026-03-10", totalUsd: "1.500000", requests: 12 }],
  recentDebits: [
    {
      id: "trace-1",
      occurredAt: "2026-03-10T20:00:00.000Z",
      model: "gpt-5-mini",
      providerSlot: null,
      amountUsd: "1.000000",
      tokensInput: 100,
      tokensOutput: 50,
      durationMs: 250,
      status: "SUCCESS",
    },
  ],
};

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      virtualKeys: { get: { invalidate: vi.fn() } },
    }),
    virtualKeys: {
      get: {
        useQuery: () => ({
          data: detail.current,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      rotate: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      revoke: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      disable: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      enable: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    modelProvider: {
      listAllForOrganizationForFrontend: {
        useQuery: () => ({ data: { providers: PROVIDERS }, isLoading: false }),
      },
    },
    routingPolicy: {
      get: {
        useQuery: () => ({
          data: policy.current.data,
          isError: policy.current.isError,
          isLoading: false,
        }),
      },
    },
    gatewayUsage: {
      summaryForVirtualKey: {
        useQuery: (input: Record<string, unknown>) => {
          usageInputs.push(input);
          return { data: usageSummary, isLoading: false };
        },
      },
    },
  },
}));

import VirtualKeyDetailPage from "../virtual-keys/[id]";

function baseKey(overrides: Record<string, unknown> = {}) {
  return {
    id: VK_ID,
    organizationId: ORG_ID,
    name: "prod-key",
    description: null,
    status: "active",
    displayPrefix: "vk-lw-abc",
    scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
    routingPolicyId: null,
    routingMode: "NONE",
    principalUserId: null,
    principalUser: null,
    traceProjectId: PROJECT_ID,
    traceProjectArchived: false,
    config: {},
    revision: "3",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <VirtualKeyDetailPage />
    </ChakraProvider>,
  );
}

describe("virtual key detail page", () => {
  beforeEach(() => {
    detail.current = baseKey();
    policy.current = { data: undefined, isError: false };
    usageInputs.length = 0;
  });
  afterEach(() => cleanup());

  describe("when the key carries a future expiration date", () => {
    /** @scenario "The detail page states when the key expires" */
    it("states the date and how long is left", async () => {
      const expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
      detail.current = baseKey({ expiresAt: expiresAt.toISOString() });
      renderPage();

      const row = await screen.findByTestId("vk-detail-expires");
      expect(row.textContent).toContain(
        expiresAt.toLocaleDateString("en-US", {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
      );
      expect(row.textContent).toContain("in 4 days");
    });
  });

  describe("when the key has no expiration date", () => {
    /** @scenario "The detail page states when the key expires" */
    it("reads Never", async () => {
      renderPage();
      expect((await screen.findByTestId("vk-detail-expires")).textContent).toBe(
        "Never",
      );
    });
  });

  describe("when the key is past its expiration date", () => {
    /** @scenario "A key past its expiration date is badged Expired" */
    it("badges a key past its date as expired", async () => {
      detail.current = baseKey({ expiresAt: "2020-01-01T00:00:00.000Z" });
      renderPage();
      expect(
        (await screen.findByTestId("vk-detail-status")).textContent,
      ).toContain("expired");
    });

    /** @scenario "An expired key can still be edited so the date can be extended" */
    it("keeps every action offered, so the date can be extended", async () => {
      detail.current = baseKey({ expiresAt: "2020-01-01T00:00:00.000Z" });
      renderPage();

      await waitFor(() =>
        expect(screen.getByRole("button", { name: /Edit/ })).toBeVisible(),
      );
      expect(screen.getByRole("button", { name: /Rotate/ })).toBeVisible();
      expect(screen.getByRole("button", { name: /Disable/ })).toBeVisible();
      expect(screen.getByRole("button", { name: /Revoke/ })).toBeVisible();
    });
  });

  describe("when the key's traces can be opened", () => {
    /** @scenario "Every place that shows a key's usage links to the traces behind it" */
    it("offers a link in the header and one over the usage block", async () => {
      renderPage();

      const header = await screen.findByTestId("vk-header-view-traces");
      expect(header.closest("a")?.getAttribute("href")).toContain(
        "/web-app/traces#all-traces?",
      );
      expect(
        screen
          .getByTestId("vk-usage-view-traces")
          .closest("a")
          ?.getAttribute("href"),
      ).toContain("/web-app/traces#all-traces?");
    });

    /** @scenario "A key with nowhere to send its traces offers no trace links" */
    it("offers neither when the key has no destination", async () => {
      detail.current = baseKey({ traceProjectId: null });
      renderPage();

      await waitFor(() =>
        expect(screen.getByText("Identity")).toBeInTheDocument(),
      );
      expect(
        screen.queryByTestId("vk-header-view-traces"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("vk-usage-view-traces"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when a model is picked from the spend breakdown", () => {
    /** @scenario "Picking a model narrows the recent activity to that model" */
    it("asks the server for that model only, and carries it into the traces link", async () => {
      renderPage();

      await userEvent.click(
        await screen.findByTestId("vk-usage-model-claude-sonnet-4-5"),
      );

      await waitFor(() =>
        expect(usageInputs.at(-1)?.model).toBe("claude-sonnet-4-5"),
      );
      expect(
        screen
          .getByTestId("vk-usage-view-traces")
          .closest("a")
          ?.getAttribute("href"),
      ).toContain(encodeURIComponent("claude-sonnet-4-5"));
    });

    /** @scenario "Clicking the picked model again clears the filter" */
    it("stops asking for a model when the same chip is clicked again", async () => {
      renderPage();

      const chip = await screen.findByTestId("vk-usage-model-gpt-5-mini");
      await userEvent.click(chip);
      await waitFor(() => expect(usageInputs.at(-1)?.model).toBe("gpt-5-mini"));

      await userEvent.click(chip);
      await waitFor(() => expect(usageInputs.at(-1)?.model).toBeUndefined());
    });
  });

  describe("when the key is pinned to a routing policy", () => {
    /** @scenario "The routing policy is named and links to itself" */
    it("names the policy and links to its drawer", async () => {
      detail.current = baseKey({
        routingPolicyId: "rp-eu",
        routingMode: "POLICY",
      });
      policy.current = {
        data: { id: "rp-eu", name: "EU only", modelProviderIds: ["mp-openai"] },
        isError: false,
      };
      renderPage();

      const link = await screen.findByTestId("vk-routing-policy-link");
      expect(link).toHaveTextContent("EU only");
      expect(link.getAttribute("href")).toBe(
        "/gateway/routing-policies?drawer.open=routingPolicy&drawer.policyId=rp-eu",
      );
    });

    /** @scenario "The routing policy is named and links to itself" */
    it("falls back to the stored identifier for a reader who cannot read policies", async () => {
      detail.current = baseKey({
        routingPolicyId: "rp-eu",
        routingMode: "POLICY",
      });
      policy.current = { data: undefined, isError: true };
      renderPage();

      expect(
        (await screen.findByTestId("vk-routing-policy-id")).textContent,
      ).toBe("rp-eu");
      expect(
        screen.queryByTestId("vk-routing-policy-link"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "A provider the routing policy leaves out is marked as such" */
    it("marks a provider the key holds but the policy does not name", async () => {
      detail.current = baseKey({
        routingPolicyId: "rp-eu",
        routingMode: "POLICY",
      });
      policy.current = {
        data: { id: "rp-eu", name: "EU only", modelProviderIds: ["mp-openai"] },
        isError: false,
      };
      renderPage();

      await waitFor(() =>
        expect(
          screen.getByTestId("vk-provider-outside-policy-mp-anthropic"),
        ).toBeVisible(),
      );
      expect(
        screen.queryByTestId("vk-provider-outside-policy-mp-openai"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the key allows only some of the providers it reaches", () => {
    /** @scenario "The provider panel shows what the key may use, not what its scope reaches" */
    it("lists only the allowed provider, and counts only that one", async () => {
      detail.current = baseKey({
        config: { providersAllowed: ["mp-anthropic"] },
      });
      renderPage();

      await waitFor(() =>
        expect(screen.getByText("Allowed model providers")).toBeVisible(),
      );
      expect(screen.getByText("Anthropic")).toBeVisible();
      expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
      expect(screen.getByText(/can route to 1 provider/)).toBeInTheDocument();
    });

    it("lists every provider in scope when the key allows them all", async () => {
      renderPage();

      await waitFor(() => expect(screen.getByText("Anthropic")).toBeVisible());
      expect(screen.getByText("OpenAI")).toBeVisible();
      expect(screen.getByText(/can route to 2 providers/)).toBeInTheDocument();
    });
  });
});
