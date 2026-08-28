/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type {
  Agent,
  AgentCopy,
  AgentHistoryEntry,
  AgentWithFields,
  CreateAgentCommand,
  RelatedAgentEntities,
  UpdateAgentCommand,
} from "@langwatch/agent-contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentBrowserPort } from "../src/model/agent-browser.port";
import {
  type AgentCardRenderInput,
  AgentManagementCardPort,
  AgentManagementFeedbackPort,
  AgentManagementLifecyclePort,
  AgentManagementNavigationPort,
  AgentManagementPage,
  type AgentArchiveDialogInput,
  type AgentCopyDialogInput,
  AgentPageCompositionPort,
  type AgentPushDialogInput,
} from "../src/features/management/ui/sections/agent-management-page";

afterEach(cleanup);

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
  copyCount: 1,
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

class TestAgentBrowser extends AgentBrowserPort {
  readonly copyCalls: unknown[] = [];
  readonly pushCalls: unknown[] = [];

  getById(): Promise<AgentWithFields> {
    return Promise.resolve(agent);
  }

  create(_input: CreateAgentCommand): Promise<AgentWithFields> {
    return Promise.resolve(agent);
  }

  update(_input: UpdateAgentCommand): Promise<AgentWithFields> {
    return Promise.resolve(agent);
  }

  relatedEntities(): Promise<RelatedAgentEntities> {
    return Promise.resolve({ workflow: null });
  }

  cascadeArchive(): Promise<{
    agent: Agent;
    archivedWorkflow: { id: string } | null;
  }> {
    return Promise.resolve({ agent, archivedWorkflow: null });
  }

  archive(): Promise<Agent> {
    return Promise.resolve(agent);
  }

  getCopies(): Promise<AgentCopy[]> {
    return Promise.resolve([
      {
        id: "agent_copy",
        name: "Agent copy",
        projectId: "project_2",
        fullPath: "Org / Team / Project",
      },
    ]);
  }

  copy(input: unknown): Promise<{
    id: string;
    projectId: string;
    name: string;
    copiedFromAgentId: string;
  }> {
    this.copyCalls.push(input);
    return Promise.resolve({
      id: "agent_copy",
      projectId: "project_2",
      name: "HTTP agent",
      copiedFromAgentId: agent.id,
    });
  }

  pushToCopies(input: unknown): Promise<{
    pushedTo: number;
    selectedCopies: number;
  }> {
    this.pushCalls.push(input);
    return Promise.resolve({ pushedTo: 1, selectedCopies: 1 });
  }

  syncFromSource(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }

  getHistory(): Promise<AgentHistoryEntry[]> {
    return Promise.resolve([]);
  }
}

class TestAgentPageComposition extends AgentPageCompositionPort {
  renderHeader(): ReactNode {
    return null;
  }

  renderArchiveDialog(_input: AgentArchiveDialogInput): ReactNode {
    if (!_input.open) return null;
    return (
      <button type="button" onClick={_input.onConfirm}>
        Confirm archive
      </button>
    );
  }

  renderCopyDialog(input: AgentCopyDialogInput): ReactNode {
    if (!input.open) return null;
    return (
      <button type="button" onClick={() => void input.onCopy("project_2")}>
        Confirm copy
      </button>
    );
  }

  renderPushDialog(input: AgentPushDialogInput): ReactNode {
    if (!input.open || input.copies.length === 0) return null;
    return (
      <button type="button" onClick={() => void input.onPush()}>
        Confirm push
      </button>
    );
  }
}

class TestNavigation extends AgentManagementNavigationPort {
  openEditor(): void {}

  openTypeSelector(): void {}

  openHistory(): void {}

  openWorkflow(): void {}
}

class TestFeedback extends AgentManagementFeedbackPort {
  showSuccess(): void {}

  showError(): void {}
}

class TestLifecycle extends AgentManagementLifecyclePort {
  agentsChangedCalls = 0;
  agentArchivedCalls = 0;

  async agentsChanged(): Promise<void> {
    this.agentsChangedCalls += 1;
  }

  async agentArchived(): Promise<void> {
    this.agentArchivedCalls += 1;
  }
}

class TestCard extends AgentManagementCardPort {
  render(props: AgentCardRenderInput): ReactNode {
    return (
      <div>
        <button type="button" onClick={props.onReplicate}>
          Replicate to another project
        </button>
        <button type="button" onClick={props.onPushToCopies}>
          Push to replicas
        </button>
        <button type="button" onClick={props.onSyncFromSource}>
          Sync from source
        </button>
        <button type="button" onClick={props.onDelete}>
          Delete agent
        </button>
      </div>
    );
  }
}

function renderPage(browser: TestAgentBrowser, lifecycle = new TestLifecycle()) {
  render(
    <ChakraProvider value={defaultSystem}>
      <AgentManagementPage
        data={{
          projectId: "project_1",
          agents: browser,
          items: [agent],
          isLoading: false,
          copyProjects: [{ label: "Project 2", value: "project_2", hasCreatePermission: true }],
        }}
        navigation={new TestNavigation()}
        feedback={new TestFeedback()}
        lifecycle={lifecycle}
        composition={new TestAgentPageComposition()}
        card={new TestCard()}
      />
    </ChakraProvider>,
  );
}

describe("AgentManagementPage", () => {
  it("replicates the selected agent to the project chosen by the host dialog", async () => {
    const browser = new TestAgentBrowser();
    const lifecycle = new TestLifecycle();
    renderPage(browser, lifecycle);

    fireEvent.click(await screen.findByText("Replicate to another project"));
    fireEvent.click(screen.getByText("Confirm copy"));

    await waitFor(() => {
      expect(browser.copyCalls).toEqual([
        {
          agentId: "agent_1",
          projectId: "project_2",
          sourceProjectId: "project_1",
        },
      ]);
      expect(lifecycle.agentsChangedCalls).toBe(1);
    });
  });

  it("loads replicas and pushes only the selected replica identifiers", async () => {
    const browser = new TestAgentBrowser();
    const lifecycle = new TestLifecycle();
    renderPage(browser, lifecycle);

    fireEvent.click(await screen.findByText("Push to replicas"));
    fireEvent.click(await screen.findByText("Confirm push"));

    await waitFor(() => {
      expect(browser.pushCalls).toEqual([
        {
          agentId: "agent_1",
          projectId: "project_1",
          copyIds: ["agent_copy"],
        },
      ]);
      expect(lifecycle.agentsChangedCalls).toBe(1);
    });
  });

  it("refreshes the visible agent data after syncing a copied agent", async () => {
    const browser = new TestAgentBrowser();
    const lifecycle = new TestLifecycle();
    renderPage(browser, lifecycle);

    fireEvent.click(await screen.findByText("Sync from source"));

    await waitFor(() => expect(lifecycle.agentsChangedCalls).toBe(1));
  });

  it("keeps archive confirmation in the host dialog and runs the archive lifecycle", async () => {
    const browser = new TestAgentBrowser();
    const lifecycle = new TestLifecycle();
    renderPage(browser, lifecycle);

    fireEvent.click(await screen.findByText("Delete agent"));
    fireEvent.click(await screen.findByText("Confirm archive"));

    await waitFor(() => expect(lifecycle.agentArchivedCalls).toBe(1));
  });
});
