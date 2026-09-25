/**
 * @vitest-environment jsdom
 *
 * The personal settings screen: credentials tabs, issuing and revoking keys,
 * workspace features and the budgets that apply.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PersonalContext } from "../../../../behavior/use-personal-context.ts";
import {
  fakePersonalWorkspaceHost,
  renderWithPersonalWorkspaceHost,
} from "../../../../testing.tsx";
import { PersonalConfigureScreen } from "../personal-configure.screen.tsx";

type MutationOptions<T> = {
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
};

type ScreenState = {
  ctx: PersonalContext | undefined;
  projectId: string | null;
  projectApiKey: string | null;
  features: { evaluations: boolean; datasets: boolean; annotations: boolean; automations: boolean };
  failWith: Error | undefined;
};

type Recorded = { name: string; input: unknown };

const { state, calls } = vi.hoisted(() => {
  const state: ScreenState = {
    ctx: undefined,
    projectId: "proj_me",
    projectApiKey: "sk-personal",
    features: { evaluations: true, datasets: true, annotations: true, automations: true },
    failWith: undefined,
  };
  const mutations: Recorded[] = [];
  const invalidations: Recorded[] = [];
  return { state, calls: { mutations, invalidations } };
});

vi.mock("../../../../behavior/use-personal-context.ts", () => ({
  usePersonalContext: () => state.ctx,
}));
vi.mock("../../personal-workspace-layout.tsx", () => ({
  PersonalWorkspaceLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../avatar-upload-control.tsx", () => ({ AvatarUploadControl: () => null }));
vi.mock("../../devices-panel.tsx", () => ({
  DevicesPanel: () => <div data-testid="devices-panel" />,
}));
vi.mock("../../home-page-picker.tsx", () => ({
  HomePagePicker: () => <div data-testid="home-page-picker" />,
}));
vi.mock("../../personal-otlp-endpoint-panel.tsx", () => ({
  PersonalOtlpEndpointPanel: ({ apiKey }: { apiKey: string }) => (
    <div data-testid="otlp-panel" data-api-key={apiKey} />
  ),
}));
vi.mock("../../budget-overview/index.ts", () => ({
  BudgetOverviewList: () => <div data-testid="budget-list" />,
}));

vi.mock("../../../../behavior/personal-workspace-api.ts", () => {
  const mutation = <T,>(name: string, answer: T) => ({
    useMutation: (options: MutationOptions<T>) => ({
      isPending: false,
      mutate: (input: unknown) => {
        calls.mutations.push({ name, input });
        if (state.failWith) return options.onError?.(state.failWith);
        options.onSuccess?.(answer);
      },
    }),
  });
  const invalidate = (name: string) => (input?: unknown) => {
    calls.invalidations.push({ name, input });
  };
  const api = {
    useUtils: () => ({
      personalVirtualKeys: { list: { invalidate: invalidate("keys.list") } },
      personalWorkspaceFeatures: { get: { invalidate: invalidate("features.get") } },
    }),
    user: {
      personalContext: {
        useQuery: () => ({
          data: state.projectId
            ? { workspace: { project: { id: state.projectId, apiKey: state.projectApiKey } } }
            : undefined,
        }),
      },
    },
    personalWorkspaceFeatures: {
      get: { useQuery: () => ({ data: state.features, isLoading: false }) },
      enableAll: mutation("enableAll", {}),
      disableAll: mutation("disableAll", {}),
    },
    personalVirtualKeys: {
      issuePersonal: mutation("issuePersonal", {
        label: "jane-laptop",
        secret: "sk-lw-secret",
        baseUrl: "https://gw.example",
      }),
      revokePersonal: mutation("revokePersonal", {}),
    },
  };
  return { api, personalWorkspaceApi: api };
});

function personalContext(overrides: Partial<PersonalContext> = {}): PersonalContext {
  return {
    ready: true,
    email: "jane@acme.dev",
    fullName: "Jane",
    joinedOn: "2024-01-01",
    organizationName: "ACME",
    organizationId: "org_1",
    routingPolicyName: null,
    summary: {
      spentThisMonthUsd: 0,
      billedThisMonthUsd: 0,
      requestsThisMonth: 0,
      requestsDeltaPctVsLastMonth: null,
      mostUsedModel: null,
    },
    budget: { status: "ok" },
    budgetOverview: { gatewayAccess: true, budgets: [], isResolved: true },
    spendByDay: [],
    spendByTool: [],
    personalProjectId: "proj_me",
    personalProjectSlug: "me",
    isPersonalProjectResolved: true,
    apiKeys: [],
    ...overrides,
  };
}

const KEY: PersonalContext["apiKeys"][number] = {
  id: "key_1",
  label: "old-laptop",
  deviceHint: "Personal device",
  os: "Unknown",
  lastUsedAt: null,
  createdAt: "2024-01-01T00:00:00.000Z",
};

beforeEach(() => {
  state.ctx = personalContext();
  state.projectId = "proj_me";
  state.projectApiKey = "sk-personal";
  state.features = { evaluations: true, datasets: true, annotations: true, automations: true };
  state.failWith = undefined;
  calls.mutations.length = 0;
  calls.invalidations.length = 0;
});

afterEach(() => cleanup());

function renderScreen(query: Record<string, string> = {}) {
  const host = fakePersonalWorkspaceHost({ query });
  renderWithPersonalWorkspaceHost(<PersonalConfigureScreen />, { host });
  return host;
}

describe("PersonalConfigureScreen", () => {
  describe("when the address names the devices tab", () => {
    it("opens the devices inventory and hides the add-key action", async () => {
      renderScreen({ tab: "devices" });

      expect(await screen.findByTestId("devices-panel")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "+ Add a new key" })).not.toBeInTheDocument();
    });
  });

  describe("when the reader switches tabs", () => {
    it("moves between the keys and devices tabs", async () => {
      renderScreen();
      expect(screen.getByRole("button", { name: "+ Add a new key" })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("tab", { name: "Devices" }));
      expect(await screen.findByTestId("devices-panel")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("tab", { name: "Virtual keys" }));
      expect(await screen.findByRole("button", { name: "+ Add a new key" })).toBeInTheDocument();
    });
  });

  describe("when a key is issued", () => {
    async function issueKey() {
      await userEvent.click(screen.getByRole("button", { name: "+ Add a new key" }));
      await userEvent.type(screen.getByPlaceholderText("e.g. jane-laptop-2"), "  jane-laptop ");
      await userEvent.click(screen.getByRole("button", { name: "Create key" }));
    }

    it("sends the trimmed label, reveals the secret once and says so", async () => {
      const host = renderScreen();
      await issueKey();

      expect(calls.mutations).toEqual([
        { name: "issuePersonal", input: { organizationId: "org_1", label: "jane-laptop" } },
      ]);
      expect(await screen.findByText("New key 'jane-laptop' created")).toBeInTheDocument();
      expect(calls.invalidations).toContainEqual({ name: "keys.list", input: undefined });
      expect(host.recording.successes).toEqual([
        expect.objectContaining({ title: "Issued personal key 'jane-laptop'" }),
      ]);
      expect(screen.queryByPlaceholderText("e.g. jane-laptop-2")).not.toBeInTheDocument();
    });

    it("reports a refusal under its own title", async () => {
      state.failWith = new Error("label_taken");
      const host = renderScreen();
      await issueKey();

      expect(host.recording.failures).toEqual([
        expect.objectContaining({ fallbackTitle: "Couldn't issue the personal key" }),
      ]);
    });
  });

  describe("when there are no keys", () => {
    it("points at the CLI login", () => {
      renderScreen();

      expect(screen.getByText(/No personal keys yet/)).toBeInTheDocument();
    });
  });

  describe("when a key is revoked", () => {
    it("asks first, then revokes and says so", async () => {
      state.ctx = personalContext({ apiKeys: [KEY] });
      const host = renderScreen();

      await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
      await userEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));

      expect(calls.mutations).toEqual([
        { name: "revokePersonal", input: { organizationId: "org_1", id: "key_1" } },
      ]);
      expect(host.recording.successes).toEqual([expect.objectContaining({ title: "Key revoked" })]);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument(),
      );
    });
  });

  describe("when advanced features are toggled", () => {
    it("disables them all when every one is on", async () => {
      const host = renderScreen();

      await userEvent.click(screen.getByRole("checkbox"));

      expect(calls.mutations).toEqual([{ name: "disableAll", input: { projectId: "proj_me" } }]);
      expect(calls.invalidations).toContainEqual({
        name: "features.get",
        input: { projectId: "proj_me" },
      });
      expect(host.recording.successes).toEqual([
        expect.objectContaining({ title: "Advanced features disabled" }),
      ]);
    });

    it("enables them all when any one is off", async () => {
      state.features = { ...state.features, automations: false };
      renderScreen();

      await userEvent.click(screen.getByRole("checkbox"));

      expect(calls.mutations).toEqual([{ name: "enableAll", input: { projectId: "proj_me" } }]);
    });

    it("reports a failure to enable under its own title", async () => {
      state.features = { ...state.features, datasets: false };
      state.failWith = new Error("boom");
      const host = renderScreen();

      await userEvent.click(screen.getByRole("checkbox"));

      expect(host.recording.failures).toEqual([
        expect.objectContaining({ fallbackTitle: "Couldn't enable advanced features" }),
      ]);
    });
  });

  describe("when there is no personal project", () => {
    it("offers neither the features toggle nor the OTLP endpoint", () => {
      state.projectId = null;
      renderScreen();

      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByTestId("otlp-panel")).not.toBeInTheDocument();
    });
  });

  describe("when the personal project has an API key", () => {
    it("shows the OTLP endpoint with that key and the landing page picker", () => {
      renderScreen();

      expect(screen.getByTestId("otlp-panel")).toHaveAttribute("data-api-key", "sk-personal");
      expect(screen.getByTestId("home-page-picker")).toBeInTheDocument();
    });
  });

  describe("when budgets are read", () => {
    it("says none apply once the answer is in and empty", () => {
      renderScreen();

      expect(screen.getByText("No budgets apply to your usage yet.")).toBeInTheDocument();
    });

    it("says nothing before the answer arrives", () => {
      state.ctx = personalContext({
        budgetOverview: { gatewayAccess: true, budgets: [], isResolved: false },
      });
      renderScreen();

      expect(screen.getByText("Budgets that apply to you")).toBeInTheDocument();
      expect(screen.queryByText("No budgets apply to your usage yet.")).not.toBeInTheDocument();
    });

    it("hides the section without gateway access", () => {
      state.ctx = personalContext({
        budgetOverview: { gatewayAccess: false, budgets: [], isResolved: true },
      });
      renderScreen();

      expect(screen.queryByText("Budgets that apply to you")).not.toBeInTheDocument();
    });
  });
});
