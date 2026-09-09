/* @vitest-environment jsdom */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { AgentWithFields as StoredAgentWithFields } from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";

/** An agent as the drawer holds one: the wire carries its instants as strings. */
type AgentWithFields = WireOf<StoredAgentWithFields>;
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AgentHttpEditorDrawer,
  type AgentHttpEditorDrawerProps,
} from "../agent-http-editor-drawer.tsx";

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

function renderEditor(props: Partial<AgentHttpEditorDrawerProps>) {
  const defaults: AgentHttpEditorDrawerProps = {
    open: true,
    projectId: "project_1",
    onClose: () => void 0,
    onCreate: async () => agent,
    onUpdate: async () => agent,
    onTest: async () => ({ success: true }),
    renderScenarioMappings: ({ mappings }) => (
      <output data-testid="scenario-mapping-count">{Object.keys(mappings).length}</output>
    ),
    renderVariables: () => null,
    renderTestPanel: () => null,
    explainTestError: () => ({ title: "Request failed" }),
    onSaveError: () => void 0,
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <AgentHttpEditorDrawer {...defaults} {...props} />
    </ChakraProvider>,
  );
}

describe("AgentHttpEditorDrawer", () => {
  it.each(["missing", "invalid"])(
    "blocks saving a %s saved agent even after editing the name",
    (state) => {
      const invalidAgent = { ...agent };
      Reflect.set(invalidAgent, "config", {});

      let updateCount = 0;
      renderEditor({
        agentId: agent.id,
        agent: state === "missing" ? null : invalidAgent,
        defaultScenarioMappings: {
          input: { type: "source", sourceId: "dataset", path: ["input"] },
        },
        onUpdate: async () => {
          updateCount += 1;
          return agent;
        },
      });

      fireEvent.change(screen.getByTestId("agent-name-input"), {
        target: { value: "Overwrite" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

      expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
      expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
      expect(updateCount).toBe(0);
    },
  );

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
