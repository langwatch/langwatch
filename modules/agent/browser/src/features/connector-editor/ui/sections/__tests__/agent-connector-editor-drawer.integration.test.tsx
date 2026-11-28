/**
 * @vitest-environment jsdom
 * @see modules/agent/specs/scenario-connector-agent.feature
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock(
  "../../../../../behavior/agent-api.ts",
  async () => (await import("./connector-editor-doubles.test-helpers.tsx")).agentApiDouble,
);
vi.mock(
  "@langwatch/dataset-client",
  async () => (await import("./connector-editor-doubles.test-helpers.tsx")).datasetClientDouble,
);
vi.mock(
  "@langwatch/browser-host/drawer",
  async () =>
    (
      await import("../../../../voice-editor/ui/sections/__tests__/voice-editor-doubles.test-helpers.tsx")
    ).drawerDouble,
);
vi.mock(
  "../../../../../ui/elements/workflow/code/workflow-code-editor.tsx",
  async () => (await import("./connector-editor-doubles.test-helpers.tsx")).codeEditorDouble,
);
vi.mock(
  "@langwatch/design-system/code-preview",
  async () => (await import("./connector-editor-doubles.test-helpers.tsx")).codePreviewDouble,
);

// This package runs without isolation: start from fresh modules, and leave none behind.
vi.resetModules();
afterAll(() => {
  vi.resetModules();
});
const { connectorState, createMock, refetchAgentMock, updateMock, SAVED_CONNECTOR } =
  await import("./connector-editor-doubles.test-helpers.tsx");
const { renderConnectorDrawer, resetConnectorState } =
  await import("./connector-editor.test-helpers.tsx");
const { SETUP_STARTER, TEARDOWN_STARTER } = await import("../../../model/connector-starters.ts");

const CALL_CODE =
  'class Code:\n    def __call__(self, input: dict):\n        return {"reply": "hi"}\n';

/** Opens a block's code editor, replaces its code and closes the editor again. */
function writeBlock(kind: "setup" | "call" | "teardown", code: string) {
  const block = screen.getByTestId(`connector-block-${kind}`);
  fireEvent.click(within(block).getByRole("button", { name: `Edit ${kind} code` }));
  fireEvent.change(screen.getByRole("textbox", { name: "Block code" }), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
}

describe("AgentConnectorEditorDrawer", () => {
  beforeEach(resetConnectorState);

  describe("given the release_scenario_connector_steps flag is off", () => {
    /** @scenario "The connector editor says connectors are not enabled while its flag is off" */
    it("shows a disabled message instead of the editor", async () => {
      connectorState.flagOn = false;
      renderConnectorDrawer();

      expect(await screen.findByTestId("connector-agents-disabled-message")).toBeInTheDocument();
      expect(screen.queryByTestId("connector-agent-name-input")).not.toBeInTheDocument();
      expect(screen.queryByTestId("save-agent-button")).not.toBeInTheDocument();
    });
  });

  describe("when a new connector is written and saved", () => {
    /** @scenario "A user writes a connector's blocks, picks its secrets and dataset, and creates it" */
    it("creates a connector agent with the call, setup, teardown, secrets, dataset and timeout", async () => {
      const user = userEvent.setup();
      connectorState.secrets = [{ name: "SHOP_ADMIN_KEY" }, { name: "OTHER_KEY" }];
      connectorState.datasets = [{ id: "dataset_orders", name: "Orders" }];
      renderConnectorDrawer();

      await user.type(await screen.findByTestId("connector-agent-name-input"), "Shop connector");
      writeBlock("call", CALL_CODE);
      await user.click(screen.getByRole("button", { name: "Add setup" }));
      await user.click(screen.getByRole("button", { name: "Add teardown" }));
      await user.click(screen.getByRole("checkbox", { name: "SHOP_ADMIN_KEY" }));
      await user.selectOptions(screen.getByTestId("connector-dataset-select"), "dataset_orders");
      await user.type(screen.getByTestId("connector-timeout-input"), "30");
      await user.click(screen.getByTestId("save-agent-button"));

      expect(createMock).toHaveBeenCalledExactlyOnceWith({
        projectId: "test-project",
        name: "Shop connector",
        type: "connector",
        config: {
          call: { language: "python", code: CALL_CODE },
          setup: { language: "python", code: SETUP_STARTER },
          teardown: { language: "python", code: TEARDOWN_STARTER },
          secretNames: ["SHOP_ADMIN_KEY"],
          fixturesDatasetId: "dataset_orders",
          timeoutMs: 30_000,
        },
      });
    });

    it("starts the call block with code that names the input it receives", async () => {
      renderConnectorDrawer();

      const call = await screen.findByTestId("connector-block-call");
      expect(call).toHaveTextContent('input["message"]');
      expect(call).toHaveTextContent('return {"reply"');
      expect(screen.getByRole("button", { name: "Add setup" })).toBeInTheDocument();
    });
  });

  describe("given a saved connector is opened", () => {
    /** @scenario "Reopening a connector loads its saved config" */
    it("loads every saved field into the form and saves it back unchanged", async () => {
      const user = userEvent.setup();
      connectorState.agentById = SAVED_CONNECTOR;
      connectorState.secrets = [{ name: "OTHER_KEY" }];
      connectorState.datasets = [{ id: "dataset_orders", name: "Orders" }];
      renderConnectorDrawer({ agentId: SAVED_CONNECTOR.id });

      await waitFor(() =>
        expect(screen.getByTestId<HTMLInputElement>("connector-agent-name-input").value).toBe(
          "Shop connector",
        ),
      );
      expect(screen.getByText("Edit Scenario Connector")).toBeInTheDocument();
      expect(screen.getByTestId("connector-block-setup")).toHaveTextContent("# make the account");
      expect(screen.getByTestId("connector-block-call")).toHaveTextContent("# call the shop");
      expect(screen.getByTestId("connector-block-teardown")).toHaveTextContent(
        "# remove the account",
      );
      expect(screen.getByRole("checkbox", { name: "SHOP_ADMIN_KEY" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "OTHER_KEY" })).not.toBeChecked();
      expect(screen.getByTestId<HTMLSelectElement>("connector-dataset-select").value).toBe(
        "dataset_orders",
      );
      expect(screen.getByTestId<HTMLInputElement>("connector-timeout-input").value).toBe("30");

      await user.click(screen.getByTestId("save-agent-button"));

      expect(createMock).not.toHaveBeenCalled();
      expect(updateMock).toHaveBeenCalledExactlyOnceWith({
        projectId: "test-project",
        id: SAVED_CONNECTOR.id,
        name: "Shop connector",
        config: SAVED_CONNECTOR.config,
      });
    });
  });

  describe("given a saved connector whose read fails", () => {
    /** @scenario "A connector whose saved config cannot be read shows the error and nothing to save" */
    it("shows the failure with Try again, and no form or Save", async () => {
      const user = userEvent.setup();
      connectorState.agentByIdError = new Error("read failed");
      renderConnectorDrawer({ agentId: SAVED_CONNECTOR.id });

      expect(await screen.findByText("Couldn't load this connector")).toBeInTheDocument();
      expect(screen.queryByTestId("connector-agent-name-input")).not.toBeInTheDocument();
      expect(screen.queryByTestId("save-agent-button")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Try again" }));

      expect(refetchAgentMock).toHaveBeenCalledOnce();
    });
  });

  describe("given a save is in flight", () => {
    /** @scenario "A connector editor cannot be closed while its save is in flight" */
    it("disables Cancel and the drawer's close button", async () => {
      connectorState.savePending = true;
      renderConnectorDrawer();

      expect(await screen.findByRole("button", { name: "Cancel" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    });
  });

  describe("when a save answers", () => {
    type Saved = { id: string; name: string };

    /** Holds the next update back until the test answers it. */
    function holdUpdate() {
      let answer: (agent: Saved) => void = () => undefined;
      updateMock.mockImplementationOnce(
        () =>
          new Promise<Saved>((resolve) => {
            answer = resolve;
          }),
      );
      return (agent: Saved) => answer(agent);
    }

    let answer: (agent: Saved) => void;
    let onSave: Mock<() => void>;
    let onClose: Mock<() => void>;

    beforeEach(() => {
      answer = holdUpdate();
      onSave = vi.fn<() => void>();
      onClose = vi.fn<() => void>();
    });

    async function saveSavedConnector(props: { onSave: () => void; onClose: () => void }) {
      const user = userEvent.setup();
      connectorState.agentById = SAVED_CONNECTOR;
      const drawer = renderConnectorDrawer({ agentId: SAVED_CONNECTOR.id, ...props });
      await waitFor(() =>
        expect(screen.getByTestId<HTMLInputElement>("connector-agent-name-input").value).toBe(
          "Shop connector",
        ),
      );
      await user.click(screen.getByTestId("save-agent-button"));
      return drawer;
    }

    /** @scenario "A connector save that answers after its editor closed closes nothing" */
    it("calls neither onSave nor onClose when its editor closed first", async () => {
      const drawer = await saveSavedConnector({ onSave, onClose });

      drawer.rerender({ open: false });
      answer(SAVED_CONNECTOR);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(updateMock).toHaveBeenCalledOnce();
      expect(onSave).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    /** @scenario "A connector save that answers after its editor closed closes nothing" */
    it("closes its editor and reports the agent while the editor is still open", async () => {
      await saveSavedConnector({ onSave, onClose });

      answer(SAVED_CONNECTOR);

      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(onSave).toHaveBeenCalledExactlyOnceWith(SAVED_CONNECTOR);
    });
  });

  describe("when the form would store a config the connector schema refuses", () => {
    /** @scenario "A connector with no call code is not saved" */
    it("shows the call block's error and sends nothing when the call code is empty", async () => {
      const user = userEvent.setup();
      renderConnectorDrawer();

      await user.type(await screen.findByTestId("connector-agent-name-input"), "Shop connector");
      writeBlock("call", "   ");
      await user.click(screen.getByTestId("save-agent-button"));

      expect(
        within(screen.getByTestId("connector-block-call")).getByText(
          "A connector block needs code.",
        ),
      ).toBeInTheDocument();
      expect(createMock).not.toHaveBeenCalled();
    });

    /** @scenario "A connector naming a secret outside the secret name pattern is not saved" */
    it("shows the secrets error and sends nothing when a picked name breaks the pattern", async () => {
      const user = userEvent.setup();
      connectorState.secrets = [{ name: "legacy_token" }];
      renderConnectorDrawer();

      await user.type(await screen.findByTestId("connector-agent-name-input"), "Shop connector");
      await user.click(screen.getByRole("checkbox", { name: "legacy_token" }));
      await user.click(screen.getByTestId("save-agent-button"));

      expect(
        within(screen.getByTestId("connector-secrets-field")).getByText(
          "A secret name is capital letters, digits and underscores, starting with a letter.",
        ),
      ).toBeInTheDocument();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("asks for a name and sends nothing when the name is empty", async () => {
      const user = userEvent.setup();
      renderConnectorDrawer();

      await user.click(await screen.findByTestId("save-agent-button"));

      expect(screen.getByText("Name is required")).toBeInTheDocument();
      expect(createMock).not.toHaveBeenCalled();
    });
  });
});
