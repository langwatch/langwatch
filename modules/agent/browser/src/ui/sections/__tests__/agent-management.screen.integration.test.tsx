/** @vitest-environment jsdom */

/**
 * The Agents page, driven the way a reader drives it.
 * Spec: specs/agents/agent-management.feature
 */

import type {
  Agent,
  AgentCopy,
  AgentHistoryEntry,
  AgentLabel,
  AgentVersions,
  AgentWithFields,
  AgentOverview,
  RelatedAgentEntities,
} from "@langwatch/agent-contract";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentClient } from "../../../model/agent-client.ts";
import {
  type AgentManagementHost,
  AgentManagementHostProvider,
  type AgentCopyTarget,
  type AgentEditorDrawer,
  type AgentFailureNotice,
  type AgentHostProject,
  type AgentRouteReading,
  type AgentSuccessNotice,
} from "../../../model/agent-management-host.ts";

const agent: AgentWithFields = {
  id: "agent_1",
  projectId: "project_1",
  name: "HTTP agent",
  type: "http",
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  copyCount: 2,
  config: {
    name: "HTTP",
    description: "HTTP API endpoint",
    url: "https://example.test/run",
    method: "POST",
  },
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
};

const workflowAgent: AgentWithFields = {
  ...agent,
  id: "agent_2",
  name: "Workflow agent",
  type: "workflow",
  workflowId: "workflow_1",
  config: { name: "Workflow", description: "A graph" },
};

const copies: AgentCopy[] = [
  { id: "copy_1", name: "Replica A", projectId: "project_2", fullPath: "Org / Team / Project A" },
  { id: "copy_2", name: "Replica B", projectId: "project_3", fullPath: "Org / Team / Project B" },
];

const history: AgentHistoryEntry[] = [
  {
    id: "entry_1",
    action: "agents.create",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    args: {},
    user: { id: "user_1", name: "Ada", email: "ada@example.test" },
  },
];

function versionRow(version: number, commitMessage: string | null) {
  return {
    id: `version_${version}`,
    agentId: "agent_1",
    projectId: "project_1",
    version,
    name: "HTTP agent",
    type: "http" as const,
    config: {},
    workflowId: null,
    commitMessage,
    authorId: "user_1",
    authorKind: "user" as const,
    author: { id: "user_1", name: "Ada", email: "ada@example.test" },
    createdAt: new Date(`2026-01-0${version}T00:00:00.000Z`),
    labels: version === 1 ? ["production"] : [],
  };
}

const versions: AgentVersions = {
  versions: [versionRow(2, "Point at the new endpoint"), versionRow(1, null)],
  labels: [
    {
      label: "production",
      versionId: "version_1",
      version: 1,
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      updatedById: "user_1",
    },
  ],
  availableLabels: ["production", "staging"],
};

const invalidateAgents = vi.fn(async () => undefined);
const invalidateLimit = vi.fn(async () => undefined);
const listedAgents = { current: [agent] as AgentWithFields[] };
const listFailure: { current: Error | null } = { current: null };
const testRunFailure: { current: Error | null } = { current: null };
const requestedTestRuns = vi.fn();
const refetchAgents = vi.fn(async () => void 0);

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
  }),
}));

vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    scenarios: {
      testAgentRun: {
        useMutation: (options: {
          onSuccess: (run: { scenarioRunId: string; batchRunId: string }) => void;
          onError: (error: Error) => void;
        }) => ({
          mutate: (input: { agentId: string; projectId: string }) => {
            requestedTestRuns(input);
            if (testRunFailure.current) {
              options.onError(testRunFailure.current);
              return;
            }
            options.onSuccess({ scenarioRunId: "run_1", batchRunId: "batch_1" });
          },
        }),
      },
    },
  },
}));

vi.mock("../../../behavior/agent-api.ts", () => ({
  agentApi: {
    agents: {
      getAll: {
        useQuery: () => ({
          data: listedAgents.current,
          isLoading: false,
          error: listFailure.current,
          refetch: refetchAgents,
          isFetching: false,
        }),
      },
    },
    useUtils: () => ({
      agents: { getAll: { invalidate: invalidateAgents } },
    }),
  },
}));

class TestAgentBrowser implements AgentClient {
  relatedError: Error | null = null;
  readonly archived: unknown[] = [];
  readonly copied: unknown[] = [];
  readonly pushed: unknown[] = [];
  readonly historyRead: unknown[] = [];

  getById(): Promise<AgentWithFields> {
    return Promise.resolve(agent);
  }
  create(): Promise<AgentWithFields> {
    return Promise.resolve(agent);
  }
  update(): Promise<AgentWithFields> {
    return Promise.resolve(agent);
  }
  relatedEntities(): Promise<RelatedAgentEntities> {
    if (this.relatedError) return Promise.reject(this.relatedError);
    return Promise.resolve({ workflow: null });
  }
  cascadeArchive(): Promise<{ agent: Agent; archivedWorkflow: { id: string } | null }> {
    return Promise.resolve({ agent, archivedWorkflow: null });
  }
  archive(input: unknown): Promise<Agent> {
    this.archived.push(input);
    return Promise.resolve(agent);
  }
  getCopies(): Promise<AgentCopy[]> {
    return Promise.resolve(copies);
  }
  copy(input: unknown): Promise<{
    id: string;
    projectId: string;
    name: string;
    copiedFromAgentId: string;
  }> {
    this.copied.push(input);
    return Promise.resolve({
      id: "agent_copy",
      projectId: "project_2",
      name: "HTTP agent",
      copiedFromAgentId: "agent_1",
    });
  }
  pushToCopies(input: unknown): Promise<{ pushedTo: number; selectedCopies: number }> {
    this.pushed.push(input);
    return Promise.resolve({ pushedTo: 1, selectedCopies: 1 });
  }
  syncFromSource(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }
  getHistory(input: unknown): Promise<AgentHistoryEntry[]> {
    this.historyRead.push(input);
    return Promise.resolve(history);
  }

  readonly labelsAssigned: unknown[] = [];
  versionsRead = 0;
  /** A handled error the next label assignment rejects with, once. */
  assignRefusal: unknown = null;

  listVersions(): Promise<AgentVersions> {
    this.versionsRead += 1;
    return Promise.resolve(versions);
  }

  assignLabel(input: { label: string; version: number }): Promise<AgentLabel> {
    if (this.assignRefusal) {
      const refusal = this.assignRefusal;
      this.assignRefusal = null;
      return Promise.reject(refusal);
    }
    this.labelsAssigned.push(input);
    return Promise.resolve({
      label: input.label,
      version: input.version,
      versionId: `version_${input.version}`,
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
      updatedById: "user_1",
    });
  }

  removeLabel(): Promise<void> {
    return Promise.resolve();
  }
}

const COPY_TARGETS: AgentCopyTarget[] = [
  { label: "Org / Team / Allowed", value: "project_2", hasCreatePermission: true },
  { label: "Org / Team / No permission", value: "project_3", hasCreatePermission: false },
];

class TestHost implements AgentManagementHost {
  currentProject = { id: "project_1", slug: "acme", name: "Acme" };
  readonly setQueryCalls: Record<string, string | undefined>[] = [];
  readonly navigated: string[] = [];
  readonly successes: AgentSuccessNotice[] = [];
  readonly failures: AgentFailureNotice[] = [];
  readonly editorsOpened: { drawer: AgentEditorDrawer; agentId?: string }[] = [];

  constructor(
    readonly browser: TestAgentBrowser,
    private query: Readonly<Record<string, string | undefined>> = {},
  ) {}

  project(): AgentHostProject | undefined {
    return this.currentProject;
  }
  agents(): AgentClient {
    return this.browser;
  }
  copyTargets(): readonly AgentCopyTarget[] {
    return COPY_TARGETS;
  }
  route(): AgentRouteReading {
    return { params: { project: "acme" }, query: this.query };
  }
  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.setQueryCalls.push({ ...next });
    // Like the real address: the next render reads what was set.
    this.query = next;
  }
  navigate(to: string): void {
    this.navigated.push(to);
  }
  succeeded(notice: AgentSuccessNotice): void {
    this.successes.push(notice);
  }
  failed(failure: AgentFailureNotice): void {
    this.failures.push(failure);
  }
  describeFailure(failure: AgentFailureNotice): string {
    return failure.fallbackTitle;
  }
  isFeatureEnabled(): boolean {
    return true;
  }
  openAgentEditor(input: { drawer: AgentEditorDrawer; agentId?: string }): void {
    this.editorsOpened.push(input);
  }
  readonly connectedAgentsOpened: string[] = [];
  readonly testRunsOpened: { scenarioRunId: string; batchRunId: string }[] = [];
  openTestRun(run: { scenarioRunId: string; batchRunId: string }): void {
    this.testRunsOpened.push(run);
  }
  refreshAgentLimit(): Promise<void> {
    return invalidateLimit();
  }
  openConnectedAgent(agentId: string): void {
    this.connectedAgentsOpened.push(agentId);
  }
}

async function mountScreen(query: Record<string, string | undefined> = {}) {
  const { AgentManagementScreen } = await import("../agent-management-screen.tsx");
  const browser = new TestAgentBrowser();
  const host = new TestHost(browser, query);
  const content = () => (
    <AgentManagementHostProvider value={host}>
      <AgentManagementScreen />
    </AgentManagementHostProvider>
  );
  const view = renderWithDesignSystem(content());
  return { host, browser, rerender: () => view.rerender(content()) };
}

async function openAgentActions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Actions for HTTP agent" }));
}

describe("testing an agent from the real management screen", () => {
  /** @scenario "Test agent is wired to the real management action" */
  /** @scenario "The card menu offers Test agent and opens the run drawer" */
  it("starts a test and opens the returned run", async () => {
    const user = userEvent.setup();
    const { host } = await mountScreen();

    await openAgentActions(user);
    await user.click(await screen.findByTestId("agent-test-agent_1"));

    expect(requestedTestRuns).toHaveBeenCalledWith({ agentId: "agent_1", projectId: "project_1" });
    expect(host.testRunsOpened).toEqual([{ scenarioRunId: "run_1", batchRunId: "batch_1" }]);
  });

  /** @scenario "A refused test run is explained in the words of the registry" */
  it("explains a refusal without opening a run", async () => {
    const user = userEvent.setup();
    const failure = new Error("agent_test_refused");
    testRunFailure.current = failure;
    const { host } = await mountScreen();

    await openAgentActions(user);
    await user.click(await screen.findByTestId("agent-test-agent_1"));

    expect(host.failures).toEqual([
      { error: failure, fallbackTitle: "Couldn't start the test run" },
    ]);
    expect(host.testRunsOpened).toEqual([]);
  });

  /** @scenario "Test agent is wired to the real management action" */
  /** @scenario "The connected agent row offers Test agent" */
  it("starts a test from the connected agent menu", async () => {
    const user = userEvent.setup();
    const connectedAgent = {
      ...agent,
      name: "Connected agent",
      type: "connected",
      config: { parameters: [], sdk: { name: "langwatch", version: "1", language: "python" } },
      instances: [],
      parameters: [],
      status: "online",
      environment: "production",
      hostLabel: null,
      lastSeenAt: null,
      owner: null,
      ownerUserId: null,
      selectable: true,
      notSelectableReason: null,
    } satisfies AgentOverview;
    listedAgents.current = [connectedAgent];
    const { host } = await mountScreen();

    await user.click(screen.getByLabelText("Actions for Connected agent"));
    await user.click(await screen.findByTestId("agent-test-agent_1"));

    expect(requestedTestRuns).toHaveBeenCalledWith({ agentId: "agent_1", projectId: "project_1" });
    expect(host.testRunsOpened).toHaveLength(1);
  });
});

describe("given a voice or a prompt agent on the management screen", () => {
  const untestable: AgentWithFields[] = [
    {
      ...agent,
      id: "agent_voice",
      name: "Voice agent",
      type: "voice",
      config: { transport: "elevenlabs_convai", agentId: "el_agent" },
    },
    {
      ...agent,
      id: "agent_signature",
      name: "Prompt agent",
      type: "signature",
      config: { prompt: "summarize" },
    },
  ];

  /** @scenario "Voice and prompt agent cards do not offer Test agent" */
  it.each(untestable)("does not offer Test agent on the $type card", async (listed) => {
    const user = userEvent.setup();
    listedAgents.current = [listed];
    await mountScreen();

    await user.click(screen.getByRole("button", { name: `Actions for ${listed.name}` }));

    expect(await screen.findByText("Edit")).toBeInTheDocument();
    expect(screen.queryByTestId(`agent-test-${listed.id}`)).not.toBeInTheDocument();
  });
});

beforeEach(() => {
  listedAgents.current = [agent];
  listFailure.current = null;
  testRunFailure.current = null;
  requestedTestRuns.mockClear();
  refetchAgents.mockClear();
  invalidateAgents.mockClear();
  invalidateLimit.mockClear();
});

describe("given the agents page", () => {
  /** @scenario "Failed reads cannot appear as an empty list or authorize deletion" */
  it("shows a refused list as an error instead of an empty project", async () => {
    const user = userEvent.setup();
    listFailure.current = new Error("Access denied");
    listedAgents.current = [];
    await mountScreen();

    expect(screen.getByText("Couldn't load agents")).toBeInTheDocument();
    expect(screen.queryByText("No agents yet")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchAgents).toHaveBeenCalledOnce();
  });

  it("clears the selected agent when the active project changes", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { host, browser, rerender } = await mountScreen();
    await openAgentActions(user);
    await user.click(screen.getByRole("menuitem", { name: /delete/i }));
    expect(await screen.findByTestId("cascade-archive-confirm-input")).toBeInTheDocument();

    host.currentProject = { id: "project_2", slug: "other", name: "Other" };
    rerender();

    await waitFor(() => {
      expect(screen.queryByTestId("cascade-archive-confirm-input")).not.toBeInTheDocument();
    });
    expect(browser.archived).toEqual([]);
  });

  describe("when a card is opened", () => {
    /** @scenario "An editor the application still registers is addressed by the application" */
    it("asks the application for the editor that agent's type is behind", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host } = await mountScreen();

      await user.click(
        within(screen.getByTestId("agent-card-agent_1")).getByRole("button", {
          name: "HTTP agent",
        }),
      );

      expect(host.editorsOpened).toEqual([{ drawer: "agentHttpEditor", agentId: "agent_1" }]);
    });
  });

  describe("when a workflow agent's graph is opened", () => {
    it("navigates to the studio rather than an editor drawer", async () => {
      listedAgents.current = [workflowAgent];
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host } = await mountScreen();

      await user.click(screen.getByRole("button", { name: "Actions for Workflow agent" }));
      await user.click(screen.getByRole("menuitem", { name: /open workflow/i }));

      expect(host.navigated).toEqual(["/acme/studio/workflow_1"]);
    });
  });

  describe("when history is asked for", () => {
    /** @scenario "An overlay the package owns is addressed by the screen's own query key" */
    it("addresses the overlay with the screen's own query key", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host } = await mountScreen();

      await openAgentActions(user);
      await user.click(screen.getByRole("menuitem", { name: /view history/i }));

      expect(host.setQueryCalls).toEqual([{ history: "agent_1" }]);
    });
  });

  describe("when the address already names an agent's history", () => {
    /** @scenario "An overlay the package owns is addressed by the screen's own query key" */
    it("renders it through the browser port and clears the key on close", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host, browser } = await mountScreen({ history: "agent_1" });

      await waitFor(() => {
        expect(browser.historyRead).toEqual([{ agentId: "agent_1", projectId: "project_1" }]);
      });
      expect(await screen.findByText("HTTP agent history")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /close/i }));

      expect(host.setQueryCalls).toEqual([{ history: void 0 }]);
    });
  });

  describe("when an agent's history lists its versions", () => {
    /** @scenario "The history drawer shows versions and opens the deploy dialog" */
    it("shows each version with its labels and deploys staging to a version", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { browser } = await mountScreen({ history: "agent_1" });

      const list = await screen.findByTestId("agent-versions");
      expect(within(list).getByText("v2")).toBeInTheDocument();
      expect(within(list).getByText("Point at the new endpoint")).toBeInTheDocument();
      expect(within(list).getByText("production")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Deploy" }));
      const dialog = await screen.findByRole("dialog", { name: /deploy http agent/i });
      const [, staging] = within(dialog).getAllByRole("combobox");
      await user.click(staging!);
      await user.click(await screen.findByRole("option", { name: /v2/ }));
      await user.click(within(dialog).getByTestId("agent-deploy-save"));

      await waitFor(() => {
        expect(browser.labelsAssigned).toEqual([
          { projectId: "project_1", agentId: "agent_1", label: "staging", version: 2 },
        ]);
      });
    });

    /** @scenario "A failed label save shows the registered error and reads the labels again" */
    it("shows the registered copy for a refused label and reads the labels again", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { browser } = await mountScreen({ history: "agent_1" });
      browser.assignRefusal = { code: "agent_version_not_found", httpStatus: 404, meta: {} };

      await screen.findByTestId("agent-versions");
      await user.click(screen.getByRole("button", { name: "Deploy" }));
      const dialog = await screen.findByRole("dialog", { name: /deploy http agent/i });
      const readsBefore = browser.versionsRead;
      const [, staging] = within(dialog).getAllByRole("combobox");
      await user.click(staging!);
      await user.click(await screen.findByRole("option", { name: /v2/ }));
      await user.click(within(dialog).getByTestId("agent-deploy-save"));

      const alert = await within(dialog).findByRole("alert");
      expect(alert.textContent).toMatch(/^That agent version doesn't exist/);
      expect(alert.textContent).not.toContain("agent_version_not_found");
      await waitFor(() => expect(browser.versionsRead).toBeGreaterThan(readsBefore));
      expect(screen.getByRole("dialog", { name: /deploy http agent/i })).toBeInTheDocument();
    });

    /** @scenario "The deploy dialog adds a custom label and refuses a reserved one" */
    it("adds a custom label, refuses a reserved one and cancels with Escape", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { browser } = await mountScreen({ history: "agent_1" });

      await screen.findByTestId("agent-versions");
      await user.click(screen.getByRole("button", { name: "Deploy" }));
      const dialog = await screen.findByRole("dialog", { name: /deploy http agent/i });

      await user.click(within(dialog).getByRole("button", { name: "+ Add label" }));
      await user.type(within(dialog).getByPlaceholderText(/label name/i), "latest");
      expect(within(dialog).getByText(/always points at the newest version/)).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
      await user.keyboard("{Escape}");
      expect(within(dialog).queryByPlaceholderText(/label name/i)).not.toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: "+ Add label" }));
      await user.type(within(dialog).getByPlaceholderText(/label name/i), "canary{Enter}");
      expect(within(dialog).getByText("canary")).toBeInTheDocument();
      const canary = within(dialog).getAllByRole("combobox").at(-1);
      await user.click(canary!);
      await user.click(await screen.findByRole("option", { name: /v1/ }));
      await user.click(within(dialog).getByTestId("agent-deploy-save"));

      await waitFor(() => {
        expect(browser.labelsAssigned).toEqual([
          { projectId: "project_1", agentId: "agent_1", label: "canary", version: 1 },
        ]);
      });
    });
  });

  describe("when a new agent is started", () => {
    it("addresses the type selector with the screen's own query key", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host } = await mountScreen();

      await user.click(screen.getByRole("button", { name: /new agent/i }));

      expect(host.setQueryCalls).toEqual([{ new: "agent" }]);
    });
  });

  describe("when the address already asks for a new agent", () => {
    /** @scenario "Selecting type navigates to appropriate editor" */
    it("offers the types, and a choice opens the application's editor for it", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host } = await mountScreen({ new: "agent" });

      expect(screen.getByText("Choose Agent Connection Type")).toBeInTheDocument();
      await user.click(screen.getByTestId("agent-type-code"));

      expect(host.setQueryCalls).toEqual([{ new: void 0 }]);
      expect(host.editorsOpened).toEqual([{ drawer: "agentCodeEditor" }]);
    });
  });

  describe("when an agent is replicated", () => {
    it("refuses a project the reader may not create in", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { browser } = await mountScreen();

      await openAgentActions(user);
      await user.click(screen.getByRole("menuitem", { name: /replicate/i }));

      expect(screen.getByText("(no permission)")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Replicate" }));
      expect(screen.getByText("Choose a project you can create agents in.")).toBeInTheDocument();

      await user.click(screen.getByRole("combobox"));
      const refused = await screen.findAllByRole("option", {
        name: /Org \/ Team \/ No permission/,
        hidden: true,
      });
      await user.click(refused.find((option) => option.tagName === "DIV")!);

      await user.click(screen.getByRole("button", { name: "Replicate" }));
      expect(browser.copied).toEqual([]);

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(browser.copied).toEqual([]);
    });

    it("copies into the project the reader chose, and says so", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host, browser } = await mountScreen();

      await openAgentActions(user);
      await user.click(screen.getByRole("menuitem", { name: /replicate/i }));
      await user.click(screen.getByRole("combobox"));
      const allowed = await screen.findAllByRole("option", {
        name: /Org \/ Team \/ Allowed/,
        hidden: true,
      });
      await user.click(allowed.find((option) => option.tagName === "DIV")!);
      await user.click(screen.getByRole("button", { name: "Replicate" }));

      await waitFor(() => {
        expect(browser.copied).toEqual([
          { agentId: "agent_1", projectId: "project_2", sourceProjectId: "project_1" },
        ]);
      });
      expect(host.successes.map((notice) => notice.title)).toEqual(["Agent replicated"]);
    });
  });

  describe("when an agent is pushed to its replicas", () => {
    it("pushes only the replicas still selected", async () => {
      const user = userEvent.setup();
      const { host, browser } = await mountScreen();

      await openAgentActions(user);
      await user.click(screen.getByRole("menuitem", { name: /push to replicas/i }));

      expect(await screen.findByText("Replica A")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Push to 2 replicas" })).toBeEnabled();

      await user.click(screen.getByRole("checkbox", { name: /Replica A/i }));
      await user.click(screen.getByRole("button", { name: "Push to 1 replica" }));

      await waitFor(() => {
        expect(browser.pushed).toEqual([
          { agentId: "agent_1", projectId: "project_1", copyIds: ["copy_2"] },
        ]);
      });
      expect(host.successes.map((notice) => notice.title)).toEqual(["Agent pushed"]);
    });

    it("pushes nothing when the dialog is cancelled", async () => {
      const user = userEvent.setup();
      const { browser } = await mountScreen();

      await openAgentActions(user);
      await user.click(screen.getByRole("menuitem", { name: /push to replicas/i }));
      expect(await screen.findByText("Replica A")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(browser.pushed).toEqual([]);
    });
  });

  describe("when an agent is deleted", () => {
    /** @scenario "Failed reads cannot appear as an empty list or authorize deletion" */
    it("closes confirmation when related resources cannot be checked", async () => {
      const user = userEvent.setup();
      const { browser, host } = await mountScreen();
      const failure = new Error("resource_read_failed");
      browser.relatedError = failure;

      await openAgentActions(user);
      await user.click(screen.getByRole("menuitem", { name: /delete/i }));

      await waitFor(() =>
        expect(host.failures).toEqual([
          { error: failure, fallbackTitle: "Couldn't load related agent resources" },
        ]),
      );
      await waitFor(() =>
        expect(screen.queryByTestId("cascade-archive-confirm-button")).not.toBeInTheDocument(),
      );
      expect(browser.archived).toEqual([]);
    });

    it("archives it once the confirmation is typed, and frees the plan seat", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { browser } = await mountScreen();

      await openAgentActions(user);
      await user.click(screen.getByRole("menuitem", { name: /delete/i }));

      expect(await screen.findByTestId("cascade-archive-confirm-button")).toBeDisabled();

      await user.type(screen.getByTestId("cascade-archive-confirm-input"), "delete");
      // The enabled button replaces the disabled one (its reason wrapper goes), so ask again.
      await user.click(screen.getByTestId("cascade-archive-confirm-button"));

      await waitFor(() => {
        expect(browser.archived).toEqual([{ id: "agent_1", projectId: "project_1" }]);
      });
      await waitFor(() => {
        expect(invalidateLimit).toHaveBeenCalled();
      });
    });
  });
});
