/* @vitest-environment jsdom */

import type { AgentWithFields as StoredAgentWithFields } from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";

/** An agent as the drawer holds one: the wire carries its instants as strings. */
type AgentWithFields = WireOf<StoredAgentWithFields>;
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentHttpEditorDrawer,
  type AgentHttpEditorDrawerProps,
} from "../agent-http-editor-drawer.tsx";

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
    renderScenarioMappings: () => null,
    renderVariables: () => null,
    renderTestPanel: () => null,
    explainTestError: () => ({ title: "Request failed" }),
    onSaveError: () => void 0,
    ...props,
  };
}

function renderEditor(props: Partial<AgentHttpEditorDrawerProps> = {}) {
  return renderWithDesignSystem(<AgentHttpEditorDrawer {...editorProps(props)} />);
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
        const { rerender } = renderWithDesignSystem(
          <AgentHttpEditorDrawer {...editorProps({ agent, agentId: agent.id })} />,
        );

        await waitFor(() => {
          expect(screen.getByPlaceholderText("$.conversation_id")).toHaveValue("$.conversation_id");
        });

        rerender(<AgentHttpEditorDrawer {...editorProps()} />);

        await waitFor(() => {
          expect(screen.getByPlaceholderText("$.conversation_id")).toHaveValue("");
        });
      });
    });

    describe("when the agent is saved", () => {
      /** @scenario "The HTTP and code agent drawers test a saved agent" */
      it("shows the test panel below the form for that agent", async () => {
        const agent = savedAgent({});
        const panelFor: unknown[] = [];

        renderEditor({
          agent,
          agentId: agent.id,
          renderTestPanel: (input) => {
            panelFor.push(input);
            return <div data-testid="test-panel" />;
          },
        });

        expect(await screen.findByTestId("test-panel")).toBeInTheDocument();
        expect(panelFor).toContainEqual({ agentId: "agent_1", projectId: "project_1" });
      });
    });

    describe("when the agent is a new draft", () => {
      /** @scenario "A draft has no test panel" */
      it("shows no test panel", async () => {
        renderEditor({ renderTestPanel: () => <div data-testid="test-panel" /> });

        await waitFor(() => {
          expect(screen.getByText("Output Path (JSONPath)")).toBeInTheDocument();
        });
        expect(screen.queryByTestId("test-panel")).not.toBeInTheDocument();
      });
    });

    describe("when the editor saves a session path", () => {
      /** @scenario "The HTTP agent editor offers a session path" */
      it("persists the trimmed session path on the agent config", async () => {
        const saved: unknown[] = [];
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
            saved.push(input.config);
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
        expect(saved[0]).toMatchObject({ sessionPath: "$.conversation_id" });
      });
    });

    describe("when Save is pressed on an incomplete draft", () => {
      /** @scenario "Saving an HTTP agent without a name or endpoint says what is missing" */
      it("stays clickable, names each missing field, focuses the name and creates nothing", async () => {
        const created: unknown[] = [];
        renderEditor({
          onCreate: async (input) => {
            created.push(input);
            return savedAgent({});
          },
        });
        const save = await screen.findByRole("button", { name: "Create Agent" });
        fireEvent.change(screen.getByTestId("url-input"), { target: { value: "" } });
        expect(save).toBeEnabled();

        fireEvent.click(save);

        expect(await screen.findByText("Enter an agent name.")).toBeInTheDocument();
        expect(screen.getByText("Enter an endpoint URL.")).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId("agent-name-input")).toHaveFocus());
        expect(created).toEqual([]);

        fireEvent.change(screen.getByTestId("agent-name-input"), { target: { value: "Support" } });
        fireEvent.click(save);

        await waitFor(() => expect(screen.getByTestId("url-input")).toHaveFocus());
        expect(created).toEqual([]);
      });
    });

    describe("when a saved agent holds a credential", () => {
      /** @scenario "The HTTP agent editor never shows a stored credential" */
      it("leaves the token blank and says it is stored", async () => {
        const agent = savedAgent({ auth: { type: "bearer", token: "" } });

        renderEditor({ agent, agentId: agent.id });

        fireEvent.mouseDown(await screen.findByRole("tab", { name: "Auth" }));
        fireEvent.click(screen.getByRole("tab", { name: "Auth" }));

        const field = await screen.findByPlaceholderText("Stored; enter a new value to replace it");
        expect(field).toHaveValue("");
      });
    });

    describe("when the person types a hooks URL", () => {
      const mapped = {
        scenarioMappings: { input: { type: "source", sourceId: "dataset", path: ["input"] } },
      };

      async function openHooksTab() {
        fireEvent.mouseDown(await screen.findByRole("tab", { name: "Hooks" }));
        fireEvent.click(screen.getByRole("tab", { name: "Hooks" }));
      }

      /** @scenario "The agent form shows a new signing secret once and can rotate it" */
      it("shows a new signing secret and saves it with the hooks URL", async () => {
        const saved: Record<string, unknown>[] = [];
        const agent = savedAgent(mapped);
        renderEditor({
          agent,
          agentId: agent.id,
          onUpdate: async (input) => {
            saved.push(input.config);
            return agent;
          },
        });
        await openHooksTab();
        expect(screen.queryByTestId("hooks-new-signing-secret")).not.toBeInTheDocument();

        fireEvent.change(await screen.findByTestId("hooks-url-input"), {
          target: { value: "https://example.com/hooks" },
        });

        const shown = (await screen.findByTestId("hooks-new-signing-secret")).textContent ?? "";
        const secret = /whsec_[0-9a-f]{64}/.exec(shown)?.[0];
        expect(secret).toBeDefined();
        expect(shown).toContain("You will not see it again after you save.");

        screen.getByRole("button", { name: "Save Changes" }).click();

        await waitFor(() => expect(saved).toHaveLength(1));
        expect(saved[0]).toMatchObject({
          hooksUrl: "https://example.com/hooks",
          hooks: { setup: true, teardown: true },
          hooksSigningSecret: secret,
        });
      });

      /** @scenario "The agent form shows a new signing secret once and can rotate it" */
      it("shows only that a stored secret is set, and rotates it to a new one", async () => {
        const reference = "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET }}";
        const agent = savedAgent({
          ...mapped,
          hooksUrl: "https://example.com/hooks",
          hooks: { setup: true, teardown: false },
          hooksSigningSecret: reference,
        });
        renderEditor({ agent, agentId: agent.id });
        await openHooksTab();

        expect(await screen.findByTestId("hooks-stored-signing-secret")).toHaveTextContent(
          "A signing secret is set.",
        );
        expect(document.body.textContent).not.toContain(reference);

        fireEvent.click(screen.getByTestId("rotate-signing-secret-button"));

        expect(await screen.findByTestId("hooks-new-signing-secret")).toHaveTextContent(
          /whsec_[0-9a-f]{64}/,
        );
      });

      /** @scenario "The agent form shows a new signing secret once and can rotate it" */
      it("disables Rotate when the hooks URL is empty", async () => {
        const agent = savedAgent({
          ...mapped,
          hooksUrl: "https://example.com/hooks",
          hooks: { setup: true, teardown: false },
          hooksSigningSecret: "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET }}",
        });
        renderEditor({ agent, agentId: agent.id });
        await openHooksTab();
        const rotate = await screen.findByTestId("rotate-signing-secret-button");
        expect(rotate).toBeEnabled();

        fireEvent.change(screen.getByTestId("hooks-url-input"), { target: { value: "" } });

        expect(screen.getByTestId("rotate-signing-secret-button")).toBeDisabled();
      });

      /** @scenario "The agent form shows a new signing secret once and can rotate it" */
      it("saves the rotated secret in place of the stored reference", async () => {
        const saved: Record<string, unknown>[] = [];
        const agent = savedAgent({
          ...mapped,
          hooksUrl: "https://example.com/hooks",
          hooks: { setup: true, teardown: true },
          hooksSigningSecret: "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET }}",
        });
        renderEditor({
          agent,
          agentId: agent.id,
          onUpdate: async (input) => {
            saved.push(input.config);
            return agent;
          },
        });
        await openHooksTab();

        fireEvent.click(await screen.findByTestId("rotate-signing-secret-button"));
        const shown = (await screen.findByTestId("hooks-new-signing-secret")).textContent ?? "";
        const rotated = /whsec_[0-9a-f]{64}/.exec(shown)?.[0];
        screen.getByRole("button", { name: "Save Changes" }).click();

        await waitFor(() => expect(saved).toHaveLength(1));
        expect(rotated).toBeDefined();
        expect(saved[0]).toMatchObject({ hooksSigningSecret: rotated });
      });

      /** @scenario "The agent form shows a new signing secret once and can rotate it" */
      it("drops the unsaved secret when the hooks URL is cleared again", async () => {
        const saved: Record<string, unknown>[] = [];
        const agent = savedAgent(mapped);
        renderEditor({
          agent,
          agentId: agent.id,
          onUpdate: async (input) => {
            saved.push(input.config);
            return agent;
          },
        });
        await openHooksTab();
        const hooksUrl = await screen.findByTestId("hooks-url-input");
        fireEvent.change(hooksUrl, { target: { value: "https://example.com/hooks" } });
        expect(await screen.findByTestId("hooks-new-signing-secret")).toBeInTheDocument();

        fireEvent.change(hooksUrl, { target: { value: "" } });
        expect(screen.queryByTestId("hooks-new-signing-secret")).not.toBeInTheDocument();
        screen.getByRole("button", { name: "Save Changes" }).click();

        await waitFor(() => expect(saved).toHaveLength(1));
        expect(saved[0]?.hooksUrl).toBeUndefined();
        expect(saved[0]?.hooksSigningSecret).toBeUndefined();
        expect(JSON.stringify(saved[0])).not.toMatch(/whsec_/);
      });

      /** @scenario "The agent form shows a new signing secret once and can rotate it" */
      it("hides the secret once the drawer is closed and opened again", async () => {
        const agent = savedAgent(mapped);
        const { rerender } = renderWithDesignSystem(
          <AgentHttpEditorDrawer {...editorProps({ agent, agentId: agent.id })} />,
        );
        await openHooksTab();
        fireEvent.change(await screen.findByTestId("hooks-url-input"), {
          target: { value: "https://example.com/hooks" },
        });
        expect(await screen.findByTestId("hooks-new-signing-secret")).toBeInTheDocument();
        const stored = savedAgent({
          ...mapped,
          hooksUrl: "https://example.com/hooks",
          hooks: { setup: true, teardown: true },
          hooksSigningSecret: "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET }}",
        });

        rerender(
          <AgentHttpEditorDrawer
            {...editorProps({ agent: stored, agentId: agent.id, open: false })}
          />,
        );
        rerender(<AgentHttpEditorDrawer {...editorProps({ agent: stored, agentId: agent.id })} />);
        await openHooksTab();

        expect(await screen.findByTestId("hooks-stored-signing-secret")).toBeInTheDocument();
        expect(screen.queryByTestId("hooks-new-signing-secret")).not.toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/whsec_/);
      });
    });

    describe("when the hooks URL moves to another origin", () => {
      const storedHooks = () =>
        savedAgent({
          scenarioMappings: { input: { type: "source", sourceId: "dataset", path: ["input"] } },
          auth: { type: "bearer", token: "{{ secrets.HTTP_AGENT_1_AUTH_TOKEN }}" },
          hooksUrl: "https://example.com/hooks",
          hooks: { setup: true, teardown: true },
          hooksSigningSecret: "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET }}",
        });

      async function moveHooksUrl(hooksUrl: string) {
        fireEvent.mouseDown(await screen.findByRole("tab", { name: "Hooks" }));
        fireEvent.click(screen.getByRole("tab", { name: "Hooks" }));
        fireEvent.change(await screen.findByTestId("hooks-url-input"), {
          target: { value: hooksUrl },
        });
      }

      /**
       * @scenario "A new hooks URL on another origin is refused when the form sends the stored references back"
       * The server refuses this exact payload: agent-http-hooks-move.integration.test.ts.
       */
      it("sends the stored auth reference back, not a blank", async () => {
        const saved: Record<string, unknown>[] = [];
        const agent = storedHooks();
        renderEditor({
          agent,
          agentId: agent.id,
          onUpdate: async (input) => {
            saved.push(input.config);
            return agent;
          },
        });

        await moveHooksUrl("https://other.example.net/hooks");
        screen.getByRole("button", { name: "Save Changes" }).click();

        await waitFor(() => expect(saved).toHaveLength(1));
        expect(saved[0]).toMatchObject({
          hooksUrl: "https://other.example.net/hooks",
          auth: { type: "bearer", token: "{{ secrets.HTTP_AGENT_1_AUTH_TOKEN }}" },
        });
      });

      /** @scenario "The agent form explains a hooks URL on another origin than the stored credentials" */
      it("says to type the auth token again on the Auth tab", async () => {
        const agent = storedHooks();
        renderEditor({ agent, agentId: agent.id });

        await moveHooksUrl("https://other.example.net/hooks");

        const notice = await screen.findByTestId("hooks-move-notice");
        expect(notice).toHaveTextContent(
          "Type the auth token on the Auth tab again before you save.",
        );
        expect(notice).toHaveTextContent("A new signing secret is made for it below.");
      });

      /** @scenario "The agent form explains a hooks URL on another origin than the stored credentials" */
      it("says nothing for a first hooks URL on the turn URL's origin", async () => {
        const agent = savedAgent({ auth: { type: "bearer", token: "{{ secrets.T_TOKEN }}" } });
        renderEditor({ agent, agentId: agent.id });

        await moveHooksUrl("https://example.com/hooks");

        expect(await screen.findByTestId("hooks-new-signing-secret")).toBeInTheDocument();
        expect(screen.queryByTestId("hooks-move-notice")).not.toBeInTheDocument();
      });

      /** @scenario "The agent form explains a hooks URL on another origin than the stored credentials" */
      it("names the move for a first hooks URL on another host than the turn URL", async () => {
        const agent = savedAgent({
          auth: { type: "bearer", token: "{{ secrets.T_TOKEN }}" },
          headers: [{ key: "X-Api-Key", value: "{{ secrets.T_KEY }}" }],
        });
        renderEditor({ agent, agentId: agent.id });

        await moveHooksUrl("https://hooks.example.net/hooks");

        expect(await screen.findByTestId("hooks-move-notice")).toHaveTextContent(
          "Type the auth token on the Auth tab and the credential headers on the Headers tab again",
        );
      });

      /** @scenario "The agent form explains a hooks URL on another origin than the stored credentials" */
      it("saves a new signing secret by itself, and keeps the stored one back on the saved origin", async () => {
        const saved: Record<string, unknown>[] = [];
        const agent = storedHooks();
        renderEditor({
          agent,
          agentId: agent.id,
          onUpdate: async (input) => {
            saved.push(input.config);
            return agent;
          },
        });

        await moveHooksUrl("https://other.example.net/hooks");
        const shown = (await screen.findByTestId("hooks-new-signing-secret")).textContent ?? "";
        const rotated = /whsec_[0-9a-f]{64}/.exec(shown)?.[0];
        expect(rotated).toBeDefined();
        screen.getByRole("button", { name: "Save Changes" }).click();
        await waitFor(() => expect(saved).toHaveLength(1));
        expect(saved[0]).toMatchObject({ hooksSigningSecret: rotated });

        fireEvent.change(screen.getByTestId("hooks-url-input"), {
          target: { value: "https://example.com/other-hooks" },
        });
        expect(screen.queryByTestId("hooks-new-signing-secret")).not.toBeInTheDocument();
        expect(screen.queryByTestId("hooks-move-notice")).not.toBeInTheDocument();
        screen.getByRole("button", { name: "Save Changes" }).click();
        await waitFor(() => expect(saved).toHaveLength(2));
        expect(saved[1]).toMatchObject({
          hooksSigningSecret: "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET }}",
        });
      });
    });

    describe("when the person clears a saved hooks URL", () => {
      /** @scenario "Clearing the hooks URL in the agent form removes the signing secret" */
      it("says saving deletes the signing secret, and saves none", async () => {
        const saved: Record<string, unknown>[] = [];
        const agent = savedAgent({
          scenarioMappings: { input: { type: "source", sourceId: "dataset", path: ["input"] } },
          hooksUrl: "https://example.com/hooks",
          hooks: { setup: true, teardown: true },
          hooksSigningSecret: "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET }}",
        });
        renderEditor({
          agent,
          agentId: agent.id,
          onUpdate: async (input) => {
            saved.push(input.config);
            return agent;
          },
        });
        fireEvent.mouseDown(await screen.findByRole("tab", { name: "Hooks" }));
        fireEvent.click(screen.getByRole("tab", { name: "Hooks" }));

        fireEvent.change(await screen.findByTestId("hooks-url-input"), { target: { value: "" } });

        expect(screen.getByTestId("hooks-signing-secret-removed")).toHaveTextContent(
          "With no hooks URL, saving deletes the signing secret.",
        );
        expect(screen.queryByTestId("hooks-stored-signing-secret")).not.toBeInTheDocument();
        screen.getByRole("button", { name: "Save Changes" }).click();
        await waitFor(() => expect(saved).toHaveLength(1));
        expect(saved[0]?.hooksUrl).toBeUndefined();
        expect(saved[0]?.hooksSigningSecret).toBeUndefined();
        expect(JSON.stringify(saved[0])).not.toContain("HOOKS_SIGNING_SECRET");
      });
    });
  });
});
