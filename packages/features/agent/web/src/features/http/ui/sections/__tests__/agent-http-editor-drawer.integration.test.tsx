/* @vitest-environment jsdom */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { AgentWithFields as StoredAgentWithFields } from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/platform-api-client/feature-api";

/** An agent as the drawer holds one: the wire carries its instants as strings. */
type AgentWithFields = WireOf<StoredAgentWithFields>;
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentHttpEditorDrawer,
  type AgentHttpEditorDrawerProps,
} from "../agent-http-editor-drawer";
import { AgentHttpEditorPresentationPort } from "../agent-http-editor.presentation";

class TestPresentation extends AgentHttpEditorPresentationPort {
  renderScenarioMappings() {
    return null;
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

function savedAgent(config: Record<string, unknown>): AgentWithFields {
  return {
    id: "agent_1",
    projectId: "project_1",
    name: "Saved agent",
    type: "http",
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    config: {
      name: "HTTP",
      description: "HTTP API endpoint",
      url: "https://example.com/agent",
      method: "POST",
      ...config,
    },
    inputFields: [],
    outputFields: [],
    fieldsResolved: true,
  };
}

function editorProps(props: Partial<AgentHttpEditorDrawerProps> = {}): AgentHttpEditorDrawerProps {
  return {
    open: true,
    projectId: "project_1",
    onClose: () => void 0,
    onCreate: async () => savedAgent({}),
    onUpdate: async () => savedAgent({}),
    onTest: async () => ({ success: true }),
    presentation,
    ...props,
  };
}

function renderEditor(props: Partial<AgentHttpEditorDrawerProps> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AgentHttpEditorDrawer {...editorProps(props)} />
    </ChakraProvider>,
  );
}

describe("AgentHttpEditorDrawer", () => {
  afterEach(cleanup);

  describe("given the HTTP agent editor is open", () => {
    describe("when the drawer renders", () => {
      /** @scenario "The HTTP agent editor offers a session path" */
      it("renders the session path field beside the output path", async () => {
        renderEditor();

        await waitFor(() => {
          expect(screen.getByText("Output Path (JSONPath)")).toBeInTheDocument();
        });
        expect(screen.getByText("Session path")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("$.conversation_id")).toBeInTheDocument();
      });

      /** @scenario "The HTTP agent editor offers a session path" */
      it("opens the session path guidance from a focusable control", async () => {
        renderEditor();

        await waitFor(() => {
          expect(screen.getByText("Session path")).toBeInTheDocument();
        });
        const help = screen.getByRole("button", {
          name: "More about the session path",
        });
        help.focus();
        expect(help).toHaveFocus();
      });
    });

    describe("when a saved agent is followed by a new draft", () => {
      /** @scenario "The HTTP agent editor offers a session path" */
      it("clears the session path the saved agent carried", async () => {
        const agent = savedAgent({ sessionPath: "$.conversation_id" });
        const { rerender } = render(
          <ChakraProvider value={defaultSystem}>
            <AgentHttpEditorDrawer {...editorProps({ agent, agentId: agent.id })} />
          </ChakraProvider>,
        );

        await waitFor(() => {
          expect(screen.getByPlaceholderText("$.conversation_id")).toHaveValue("$.conversation_id");
        });

        rerender(
          <ChakraProvider value={defaultSystem}>
            <AgentHttpEditorDrawer {...editorProps()} />
          </ChakraProvider>,
        );

        await waitFor(() => {
          expect(screen.getByPlaceholderText("$.conversation_id")).toHaveValue("");
        });
      });
    });

    describe("when the editor saves a session path", () => {
      /** @scenario "The HTTP agent editor offers a session path" */
      it("persists the trimmed session path on the agent config", async () => {
        const saved: Array<{ config: Record<string, unknown> }> = [];
        const agent = savedAgent({
          sessionPath: "  $.conversation_id  ",
          scenarioMappings: {
            input: { type: "source", sourceId: "dataset", path: ["input"] },
          },
        });

        renderEditor({
          agent,
          agentId: agent.id,
          onUpdate: async (input) => {
            saved.push({ config: input.config as unknown as Record<string, unknown> });
            return agent;
          },
        });

        await waitFor(() => {
          expect(screen.getByPlaceholderText("$.conversation_id")).toHaveValue(
            "  $.conversation_id  ",
          );
        });

        screen.getByRole("button", { name: "Save Changes" }).click();

        await waitFor(() => {
          expect(saved).toHaveLength(1);
        });
        expect(saved[0]?.config).toMatchObject({ sessionPath: "$.conversation_id" });
      });
    });
  });
});
