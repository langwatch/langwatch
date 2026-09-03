/**
 * @vitest-environment jsdom
 *
 * The key's own page states where its traces land, so that sentence is where
 * the button to go read them belongs. It appears under the same gate as the
 * row action: a destination that exists, is not deleted, and sits on a team
 * the viewer belongs to.
 *
 * Real component tree, network boundary mocked.
 *
 * Spec: specs/ai-gateway/virtual-keys.feature
 */
import { cleanup, screen } from "@testing-library/react";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "org-acme";
const TEAM_ID = "team-platform";
const PROJECT_ID = "project-web-app";
const PROJECT_SLUG = "web-app";
const VK_ID = "vk-billing";

type VirtualKeyDetail = {
  id: string;
  name: string;
  status: string;
  description: string | null;
  displayPrefix: string;
  scopes: Array<{ scopeType: string; scopeId: string }>;
  routingMode: string;
  routingPolicyId: string | null;
  traceProjectId: string | null;
  traceProjectArchived: boolean;
  principalUserId: string | null;
  principalUser: null;
  config: Record<string, unknown>;
  revision: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

const { detail } = vi.hoisted(() => ({
  detail: { value: null as VirtualKeyDetail | null },
}));

vi.mock("../../../ui/sections/gateway-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Sections with their own network surface, none of which the trace
// destination depends on.
vi.mock("../../../features/guardrails/ui/sections/guardrail-attachments-section", () => ({
  GuardrailAttachmentsSection: () => null,
}));
vi.mock("../../../features/virtual-keys/ui/sections/virtual-key-edit-drawer", () => ({
  VirtualKeyEditDrawer: () => null,
}));
vi.mock("../../../features/virtual-keys/ui/sections/virtual-key-secret-reveal", () => ({
  VirtualKeySecretReveal: () => null,
}));
vi.mock("../../../features/virtual-keys/ui/sections/virtual-key-usage-snippet", () => ({
  VirtualKeyUsageSnippet: () => null,
}));

vi.mock("../../../behavior/gateway-api", () => ({
  api: {
    useUtils: () => ({
      virtualKeys: {
        get: { invalidate: async () => undefined },
        list: { invalidate: async () => undefined },
      },
    }),
    virtualKeys: {
      get: { useQuery: () => ({ data: detail.value, isLoading: false }) },
      rotate: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      revoke: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      disable: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      enable: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
    modelProvider: {
      listAllForOrganizationForFrontend: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
    routingPolicy: {
      get: {
        useQuery: () => ({ data: undefined, isError: false, isLoading: false }),
      },
    },
    gatewayUsage: {
      summaryForVirtualKey: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  },
}));

/** One organization, one team, one project, and the key the address names. */
const host = fakeGatewayHost({
  permissions: ["virtualKeys:manage"],
  params: { id: VK_ID },
  organization: {
    id: ORG_ID,
    name: "ACME",
    slug: "acme",
    teams: [
      {
        id: TEAM_ID,
        name: "platform",
        projects: [{ id: PROJECT_ID, name: "web-app", slug: PROJECT_SLUG, teamId: TEAM_ID }],
      },
    ],
  },
});

import VirtualKeyDetailPage from "../gateway-virtual-key.screen";

function keyDetail(overrides: Partial<VirtualKeyDetail> = {}): VirtualKeyDetail {
  return {
    id: VK_ID,
    name: "Billing tenant",
    status: "active",
    description: null,
    displayPrefix: "vk-lw-abc",
    scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
    routingMode: "NONE",
    routingPolicyId: null,
    traceProjectId: PROJECT_ID,
    traceProjectArchived: false,
    principalUserId: null,
    principalUser: null,
    config: {},
    revision: "1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastUsedAt: null,
    ...overrides,
  };
}

describe("View traces on the virtual key page", () => {
  beforeEach(() => {
    detail.value = keyDetail();
  });

  afterEach(cleanup);

  describe("given a trace destination that is live and reachable", () => {
    describe("when the key's page is opened", () => {
      /** @scenario View traces opens the key's destination filtered to that key */
      it("links to the destination's trace explorer filtered to the key", () => {
        renderWithGatewayHost(<VirtualKeyDetailPage />, { host });

        const href = screen.getByTestId("vk-view-traces").closest("a")?.getAttribute("href") ?? "";
        expect(href.startsWith(`/${PROJECT_SLUG}/traces#all-traces?`)).toBe(true);
        expect(href).toContain(encodeURIComponent(`"${VK_ID}"`));
      });
    });
  });

  describe("given a key with no trace destination", () => {
    describe("when the key's page is opened", () => {
      /** @scenario View traces is absent when the key has no trace destination */
      it("renders no View traces button", () => {
        detail.value = keyDetail({ traceProjectId: null });

        renderWithGatewayHost(<VirtualKeyDetailPage />, { host });

        expect(screen.queryByTestId("vk-view-traces")).toBeNull();
      });
    });
  });

  describe("given a trace destination that was deleted", () => {
    describe("when the key's page is opened", () => {
      /** @scenario View traces is absent when the trace destination was deleted */
      it("keeps the Deleted badge and renders no View traces button", () => {
        detail.value = keyDetail({ traceProjectArchived: true });

        renderWithGatewayHost(<VirtualKeyDetailPage />, { host });

        expect(screen.getByTestId("vk-trace-destination-deleted")).toBeTruthy();
        expect(screen.queryByTestId("vk-view-traces")).toBeNull();
      });
    });
  });

  describe("given a destination on a team the viewer does not belong to", () => {
    describe("when the key's page is opened", () => {
      /** @scenario View traces is absent when the destination sits on a team I cannot open */
      it("renders no View traces button", () => {
        detail.value = keyDetail({ traceProjectId: "project-elsewhere" });

        renderWithGatewayHost(<VirtualKeyDetailPage />, { host });

        expect(screen.queryByTestId("vk-view-traces")).toBeNull();
      });
    });
  });
});
