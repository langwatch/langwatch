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
  contextError: Error | null;
};

type Recorded = { name: string; input: unknown };

const { state, calls, pendingWorkspace } = vi.hoisted(() => {
  /** The wire shape of the retryable refusal sent before the personal project exists. */
  const pendingWorkspace = (): Error =>
    Object.assign(new Error("personal_workspace_pending"), {
      code: "personal_workspace_pending",
      httpStatus: 409,
      retryable: true,
    });
  const state: ScreenState = {
    ctx: undefined,
    projectId: "proj_me",
    projectApiKey: "",
    features: { evaluations: true, datasets: true, annotations: true, automations: true },
    failWith: undefined,
    contextError: null,
  };
  const mutations: Recorded[] = [];
  const invalidations: Recorded[] = [];
  return { state, calls: { mutations, invalidations }, pendingWorkspace };
});

vi.mock("../../../../behavior/use-personal-context.ts", () => ({
  usePersonalContext: () => state.ctx,
}));
vi.mock("../../personal-workspace-layout.tsx", () => ({
  PersonalWorkspaceLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../devices-panel.tsx", () => ({
  DevicesPanel: () => <div data-testid="devices-panel" />,
}));
vi.mock("../../home-page-picker.tsx", () => ({
  HomePagePicker: () => <div data-testid="home-page-picker" />,
}));
vi.mock("../../personal-otlp-endpoint-panel.tsx", () => ({
  PersonalOtlpEndpointPanel: ({ projectId }: { projectId: string }) => (
    <div data-testid="otlp-panel" data-project-id={projectId} />
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
      routingPolicy: {
        personalContext: {
          // The read answers as the server would while the workspace is still being created.
          invalidate: (input?: unknown) => {
            calls.invalidations.push({ name: "personalContext", input });
            state.contextError = pendingWorkspace();
          },
        },
      },
      personalWorkspaceFeatures: { get: { invalidate: invalidate("features.get") } },
    }),
    routingPolicy: {
      personalContext: {
        useQuery: () => ({
          data: state.projectId
            ? { workspace: { project: { id: state.projectId, apiKey: state.projectApiKey } } }
            : undefined,
          error: state.contextError,
          isFetching: false,
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
    isWorkspacePending: false,
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
  state.projectApiKey = "";
  state.features = { evaluations: true, datasets: true, annotations: true, automations: true };
  state.failWith = undefined;
  state.contextError = null;
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
  describe("when the page opens", () => {
    it("names the page and links once to the profile that owns the editing", async () => {
      const host = renderScreen();

      expect(screen.getByRole("heading", { name: "Personal configuration" })).toBeInTheDocument();
      const links = screen.getAllByRole("link", { name: "Edit profile" });
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute("href", "/settings/profile");

      await userEvent.click(links[0]!);
      expect(host.recording.navigations).toEqual(["/settings/profile"]);
    });

    it("summarises the identity without editing it or claiming IT manages the email", () => {
      state.ctx = personalContext({ routingPolicyName: "Engineering default" });
      renderScreen();

      expect(screen.getByText("Jane")).toBeInTheDocument();
      expect(screen.getByText("jane@acme.dev")).toBeInTheDocument();
      expect(screen.getByText("2024-01-01")).toBeInTheDocument();
      expect(screen.getByText("Engineering default")).toBeInTheDocument();
      expect(screen.getByText("managed by your org")).toBeInTheDocument();
      expect(screen.queryByText(/Managed by/)).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  describe("when the address names the devices tab", () => {
    it("opens the devices inventory and hides the add-key action", async () => {
      renderScreen({ tab: "devices" });

      expect(await screen.findByTestId("devices-panel")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add a new key" })).not.toBeInTheDocument();
    });
  });

  describe("when the reader switches tabs", () => {
    it("moves between the keys and devices tabs", async () => {
      const host = renderScreen();
      expect(screen.getByRole("button", { name: "Add a new key" })).toBeInTheDocument();
      expect(screen.queryByTestId("devices-panel")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("tab", { name: "Devices and keys" }));
      expect(await screen.findByTestId("devices-panel")).toBeInTheDocument();
      expect(host.recording.queries).toEqual([{ next: { tab: "devices" }, replace: true }]);

      await userEvent.click(screen.getByRole("tab", { name: "Virtual keys" }));
      expect(await screen.findByRole("button", { name: "Add a new key" })).toBeInTheDocument();
    });
  });

  describe("when the reader arrows onto the devices tab", () => {
    it("moves focus without reading the inventory, and Enter opens it", async () => {
      renderScreen();
      screen.getByRole("tab", { name: "Virtual keys" }).focus();

      await userEvent.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Devices and keys" })).toHaveFocus(),
      );
      expect(screen.queryByTestId("devices-panel")).not.toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Virtual keys" })).toHaveAttribute(
        "aria-selected",
        "true",
      );

      await userEvent.keyboard("{Enter}");
      expect(await screen.findByTestId("devices-panel")).toBeInTheDocument();
    });
  });

  describe("when a key is issued", () => {
    async function issueKey() {
      await userEvent.click(screen.getByRole("button", { name: "Add a new key" }));
      await userEvent.type(screen.getByLabelText("Name"), "  jane-laptop ");
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

    /** @scenario "Issuing a personal key waits while the personal workspace is set up" */
    it("waits for the personal workspace instead of reporting a failure", async () => {
      state.failWith = pendingWorkspace();
      const host = renderScreen();
      await issueKey();

      expect(host.recording.failures).toEqual([]);
      expect(await screen.findByRole("status")).toHaveTextContent("Setting up your workspace");
      expect(screen.getByRole("button", { name: "Create key" })).toBeDisabled();
      expect(calls.invalidations).toContainEqual({ name: "personalContext", input: undefined });
    });
  });

  describe("when there are no keys", () => {
    it("offers to add one and describes the CLI login as connecting a device", () => {
      renderScreen();

      expect(screen.getByText(/No virtual keys yet\. Add a key for a tool/)).toBeInTheDocument();
      expect(screen.getByText(/to connect a device\./)).toBeInTheDocument();
      expect(screen.getByText("langwatch login").tagName).toBe("CODE");
      expect(screen.getByRole("button", { name: "Add a new key" })).toBeInTheDocument();
    });
  });

  describe("when the reader submits the new key without a name", () => {
    it("shows a field error, focuses the name and sends nothing, until they type", async () => {
      renderScreen();
      await userEvent.click(screen.getByRole("button", { name: "Add a new key" }));

      const name = screen.getByLabelText("Name");
      await userEvent.click(screen.getByRole("button", { name: "Create key" }));
      expect(screen.getByText("Give the key a name.")).toBeInTheDocument();
      expect(name).toHaveFocus();
      expect(name).toBeInvalid();
      expect(calls.mutations).toEqual([]);

      await userEvent.type(name, "a");
      expect(screen.queryByText("Give the key a name.")).not.toBeInTheDocument();
    });

    it("treats a name of only spaces as blank", async () => {
      renderScreen();
      await userEvent.click(screen.getByRole("button", { name: "Add a new key" }));

      await userEvent.type(screen.getByLabelText("Name"), "   ");
      await userEvent.click(screen.getByRole("button", { name: "Create key" }));

      expect(screen.getByText("Give the key a name.")).toBeInTheDocument();
      expect(calls.mutations).toEqual([]);
    });
  });

  describe("when the secret of a new key is copied", () => {
    async function revealSecret() {
      const user = userEvent.setup();
      const host = renderScreen();
      await user.click(screen.getByRole("button", { name: "Add a new key" }));
      await user.type(screen.getByLabelText("Name"), "jane-laptop");
      await user.click(screen.getByRole("button", { name: "Create key" }));
      await screen.findByText("New key 'jane-laptop' created");
      return { user, host };
    }

    it("copies the whole secret and only then says so", async () => {
      const { user, host } = await revealSecret();
      host.recording.successes.length = 0;

      await user.click(screen.getByRole("button", { name: /Copy/ }));

      await waitFor(() =>
        expect(host.recording.successes).toEqual([
          expect.objectContaining({ title: "Secret copied to clipboard" }),
        ]),
      );
      expect(await navigator.clipboard.readText()).toBe("sk-lw-secret");
    });

    it("keeps the secret on screen and never claims a copy the clipboard refused", async () => {
      const { user, host } = await revealSecret();
      host.recording.successes.length = 0;
      const refused = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockRejectedValue(new Error("denied"));

      await user.click(screen.getByRole("button", { name: /Copy/ }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy to the clipboard");
      expect(screen.getByRole("alert")).not.toHaveTextContent("sk-lw-secret");
      expect(screen.getByText("sk-lw-secret")).toBeInTheDocument();
      expect(host.recording.successes).toEqual([]);

      refused.mockRestore();
      await user.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      expect(host.recording.successes).toEqual([
        expect.objectContaining({ title: "Secret copied to clipboard" }),
      ]);
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

    it("shows the key's device, last use and creation, and drops the question on cancel", async () => {
      state.ctx = personalContext({ apiKeys: [KEY] });
      renderScreen();

      expect(screen.getByText("old-laptop")).toBeInTheDocument();
      expect(screen.getByText(/Personal device · Last used/)).toBeInTheDocument();
      expect(screen.getByText(/^Created /)).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
      expect(screen.getByText(/Any tool using it will start failing immediately/)).toBeVisible();

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("button", { name: "Confirm revoke" })).not.toBeInTheDocument();
      expect(calls.mutations).toEqual([]);
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

  describe("when the personal context carries no API key", () => {
    /** @scenario "The personal context never carries the personal project's API key" */
    it("shows the OTLP endpoint for the project, which mints a token itself, and the picker", () => {
      renderScreen();

      expect(screen.getByTestId("otlp-panel")).toHaveAttribute("data-project-id", "proj_me");
      expect(screen.getByTestId("home-page-picker")).toBeInTheDocument();
    });
  });

  describe("when budgets are read", () => {
    it("says none apply once the answer is in and empty", () => {
      renderScreen();

      expect(screen.getByText(/^No budgets apply to your usage yet\./)).toBeInTheDocument();
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
