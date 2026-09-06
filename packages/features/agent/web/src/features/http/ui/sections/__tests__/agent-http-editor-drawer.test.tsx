/* @vitest-environment jsdom */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { AgentWithFields as StoredAgentWithFields } from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/platform-api-client/feature-api";

/** An agent as the drawer holds one: the wire carries its instants as strings. */
type AgentWithFields = WireOf<StoredAgentWithFields>;
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AgentHttpEditorDrawer,
  type AgentHttpEditorDrawerProps,
} from "../agent-http-editor-drawer.tsx";
import { AgentHttpEditorPresentationPort } from "../agent-http-editor.presentation.tsx";
import type { RenderScenarioMappingsInput } from "../agent-http-editor.presentation.tsx";

const agent: AgentWithFields = {
  id: "agent_1",
  projectId: "project_1",
  name: "HTTP agent",
  type: "http",
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  config: {
    name: "HTTP",
    description: "HTTP API endpoint",
    url: "https://example.test/run",
    method: "POST",
    scenarioMappings: {},
  },
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
};

class TestPresentation extends AgentHttpEditorPresentationPort {
  renderScenarioMappings({ mappings }: RenderScenarioMappingsInput) {
    return <output data-testid="scenario-mapping-count">{Object.keys(mappings).length}</output>;
  }

  renderVariables() {
    return null;
  }

  renderTestPanel() {
    return null;
  }

  explainTestError() {
    return { title: "Request failed" };
  }

  showSaveError() {}
}

const presentation = new TestPresentation();

function renderEditor(props: Partial<AgentHttpEditorDrawerProps>) {
  const defaults: AgentHttpEditorDrawerProps = {
    open: true,
    projectId: "project_1",
    onClose: () => void 0,
    onCreate: async () => agent,
    onUpdate: async () => agent,
    onTest: async () => ({ success: true }),
    presentation,
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <AgentHttpEditorDrawer {...defaults} {...props} />
    </ChakraProvider>,
  );
}

describe("AgentHttpEditorDrawer", () => {
  it("stays closed when the caller does not explicitly open it", () => {
    renderEditor({ open: void 0 });

    expect(screen.queryByText("New HTTP Agent")).toBeNull();
  });

  it("uses default scenario mappings when a stored agent has an empty mapping", async () => {
    const updates: Array<{
      id: string;
      projectId: string;
      name: string;
      config: AgentWithFields["config"];
    }> = [];
    let closeCount = 0;
    const onUpdate: AgentHttpEditorDrawerProps["onUpdate"] = async (input) => {
      updates.push(input);
      return agent;
    };

    renderEditor({
      agent,
      agentId: agent.id,
      defaultScenarioMappings: {
        input: {
          type: "source",
          sourceId: "dataset",
          path: ["input"],
        },
      },
      onClose: () => {
        closeCount += 1;
      },
      onUpdate,
    });

    await waitFor(() => {
      expect(screen.getByTestId("scenario-mapping-count").textContent).toBe("1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(updates).toHaveLength(1);
    });
    expect(updates[0]).toMatchObject({
      id: "agent_1",
      projectId: "project_1",
      name: "HTTP agent",
      config: {
        scenarioMappings: {
          input: {
            type: "source",
            sourceId: "dataset",
            path: ["input"],
          },
        },
      },
    });
    expect(closeCount).toBe(1);
  });
});
