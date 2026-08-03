/**
 * @vitest-environment jsdom
 *
 * #5588 gave PlaygroundContent `lazyMount` without `unmountOnExit`, on the
 * grounds that the Editor tab holds in-progress edits a remount would discard.
 * Nothing enforced that: adding `unmountOnExit` in a later performance pass
 * would silently throw the edit away.
 *
 * What is actually at risk is narrower than "the Input and Textarea fields".
 * Every field in SpanEditorPanel and the LLM/RAG/Prompt editors is controlled
 * straight through to the `traceStore` on each keystroke, so those survive a
 * remount either way. The one piece of state that lives only in React is
 * AttributeEditor's `newKey`, the name of an attribute typed but not yet
 * committed with the Add button. That is the draft this test protects.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ConnectionSettings and ExecutionControls sit in the always-mounted left
// sidebar and reach for the project and tRPC. Neither is under test.
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    organization: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

import { PlaygroundContent } from "../PlaygroundContent";
import { createDefaultTrace, useTraceStore } from "../traceStore";

const NEW_ATTRIBUTE_KEY = "my.pending.attribute";

function renderPlaygroundWithSelectedSpan() {
  const trace = createDefaultTrace();
  const firstSpan = trace.spans[0];
  if (!firstSpan) throw new Error("default trace should seed one span");

  useTraceStore.setState({ trace, selectedSpanId: firstSpan.id });

  return render(
    <ChakraProvider value={defaultSystem}>
      <PlaygroundContent />
    </ChakraProvider>,
  );
}

function newAttributeKeyInput() {
  return screen.getByPlaceholderText("attribute.key");
}

async function switchTo(name: string) {
  await userEvent.click(screen.getByRole("tab", { name }));
}

describe("PlaygroundContent tab state", () => {
  beforeEach(() => {
    useTraceStore.setState({
      trace: createDefaultTrace(),
      selectedSpanId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("when an uncommitted attribute key is typed and the user leaves and returns to the Editor tab", () => {
    it("preserves the typed key in the input", async () => {
      renderPlaygroundWithSelectedSpan();

      await userEvent.type(newAttributeKeyInput(), NEW_ATTRIBUTE_KEY);
      expect(newAttributeKeyInput()).toHaveValue(NEW_ATTRIBUTE_KEY);

      await switchTo("Waterfall");
      await switchTo("Editor");

      await waitFor(() => {
        expect(newAttributeKeyInput()).toHaveValue(NEW_ATTRIBUTE_KEY);
      });
    });
  });

  describe("when the user leaves and returns to the Editor tab", () => {
    it("reuses the Editor panel DOM node rather than remounting it", async () => {
      renderPlaygroundWithSelectedSpan();

      const beforeSwitch = newAttributeKeyInput();

      await switchTo("Waterfall");
      await switchTo("Editor");

      // Same DOM node, not a fresh one: this is the mechanism the draft
      // survival depends on, asserted directly so a failure says which of the
      // two broke.
      await waitFor(() => {
        expect(newAttributeKeyInput()).toBe(beforeSwitch);
      });
    });
  });

  describe("given the Graph tab has never been opened", () => {
    it("leaves the Graph panel unmounted", () => {
      renderPlaygroundWithSelectedSpan();

      // lazyMount's own half of the contract: the Graph tab pulls in
      // @xyflow/react, and the JSON tab a Monaco editor, so mounting them
      // before they are asked for is what #5588 set out to stop.
      expect(screen.queryByTestId("rf__wrapper")).toBeNull();
    });

    describe("when the user opens the Graph tab", () => {
      it("mounts the Graph panel", async () => {
        renderPlaygroundWithSelectedSpan();

        await switchTo("Graph");

        // Pairs with the assertion above: without it, a Graph view that never
        // renders at all would read as lazyMount working.
        expect(await screen.findByTestId("rf__wrapper")).toBeInTheDocument();
      });
    });
  });
});
