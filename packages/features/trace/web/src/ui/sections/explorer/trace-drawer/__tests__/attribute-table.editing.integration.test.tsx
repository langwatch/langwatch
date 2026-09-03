/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RestrictedAttribute } from "@langwatch/trace-contract";

vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

import { type AttributeEditing, AttributeTable } from "../attribute-table";

const CAPTURED = {
  "gen_ai.request.model": "gpt-5-mini",
  "gen_ai.request.temperature": 0.2,
};

function renderEditable({
  edits = {},
  onEditAttribute = vi.fn(),
  onResetAttribute = vi.fn(),
  restrictedAttributes,
}: Partial<AttributeEditing> & {
  restrictedAttributes?: RestrictedAttribute[];
} = {}) {
  const editing: AttributeEditing = {
    edits,
    onEditAttribute,
    onResetAttribute,
  };
  return render(
    <ChakraProvider value={defaultSystem}>
      <AttributeTable
        attributes={CAPTURED}
        restrictedAttributes={restrictedAttributes}
        editing={editing}
      />
    </ChakraProvider>,
  );
}

describe("AttributeTable editing", () => {
  afterEach(cleanup);

  describe("given a span with attributes being corrected", () => {
    describe("when a value is changed", () => {
      /** @scenario "Changing an attribute value records it in the correction" */
      it("records the new value for that key", () => {
        const onEditAttribute = vi.fn();
        const { getByLabelText } = renderEditable({ onEditAttribute });

        fireEvent.change(getByLabelText("Edit gen_ai.request.model"), {
          target: { value: "gpt-5" },
        });

        expect(onEditAttribute).toHaveBeenCalledWith({
          key: "gen_ai.request.model",
          value: "gpt-5",
        });
      });
    });

    describe("when an attribute is removed", () => {
      /** @scenario "Removing an attribute strikes it through and can be undone" */
      it("records the removal", () => {
        const onEditAttribute = vi.fn();
        const { getByLabelText } = renderEditable({ onEditAttribute });

        fireEvent.click(getByLabelText("Remove gen_ai.request.model"));

        expect(onEditAttribute).toHaveBeenCalledWith({
          key: "gen_ai.request.model",
          value: null,
        });
      });

      /** @scenario "Removing an attribute strikes it through and can be undone" */
      it("offers to restore it", () => {
        const onResetAttribute = vi.fn();
        const { getByLabelText } = renderEditable({
          edits: { "gen_ai.request.model": null },
          onResetAttribute,
        });

        fireEvent.click(getByLabelText("Restore gen_ai.request.model"));

        expect(onResetAttribute).toHaveBeenCalledWith("gen_ai.request.model");
      });
    });

    describe("when an attribute is added with a key that already exists", () => {
      /** @scenario "Adding an attribute rejects a key that already exists" */
      it("says the key already exists and adds nothing", () => {
        const onEditAttribute = vi.fn();
        const { getByLabelText, getByRole, getByText } = renderEditable({
          onEditAttribute,
        });

        fireEvent.change(getByLabelText("New attribute name"), {
          target: { value: "gen_ai.request.model" },
        });
        fireEvent.click(getByRole("button", { name: "Add attribute" }));

        expect(getByText("This key already exists")).toBeInTheDocument();
        expect(onEditAttribute).not.toHaveBeenCalled();
      });
    });

    describe("when an attribute is added with a key the filter is hiding", () => {
      /** @scenario "Adding an attribute rejects a key the filter is hiding" */
      it("says the key already exists and adds nothing", () => {
        const onEditAttribute = vi.fn();
        const { getByLabelText, getByPlaceholderText, getByRole, getByText } =
          renderEditable({ onEditAttribute });

        fireEvent.change(getByPlaceholderText("Filter attributes…"), {
          target: { value: "temperature" },
        });
        fireEvent.change(getByLabelText("New attribute name"), {
          target: { value: "gen_ai.request.model" },
        });
        fireEvent.click(getByRole("button", { name: "Add attribute" }));

        expect(getByText("This key already exists")).toBeInTheDocument();
        expect(onEditAttribute).not.toHaveBeenCalled();
      });
    });

    describe("when an attribute is added with a key that is a parent of one", () => {
      /** @scenario "Adding an attribute rejects a key that sits inside another one" */
      it("names the attribute it conflicts with and adds nothing", () => {
        const onEditAttribute = vi.fn();
        const { getByLabelText, getByRole, getByText } = renderEditable({
          onEditAttribute,
        });

        fireEvent.change(getByLabelText("New attribute name"), {
          target: { value: "gen_ai.request" },
        });
        fireEvent.click(getByRole("button", { name: "Add attribute" }));

        expect(
          getByText(/This key conflicts with gen_ai\.request\./),
        ).toBeInTheDocument();
        expect(onEditAttribute).not.toHaveBeenCalled();
      });
    });

    describe("when an attribute is added with a key nested under one", () => {
      /** @scenario "Adding an attribute rejects a key that sits inside another one" */
      it("names the attribute it conflicts with and adds nothing", () => {
        const onEditAttribute = vi.fn();
        const { getByLabelText, getByRole, getByText } = renderEditable({
          onEditAttribute,
        });

        fireEvent.change(getByLabelText("New attribute name"), {
          target: { value: "gen_ai.request.model.family" },
        });
        fireEvent.click(getByRole("button", { name: "Add attribute" }));

        expect(
          getByText("This key conflicts with gen_ai.request.model"),
        ).toBeInTheDocument();
        expect(onEditAttribute).not.toHaveBeenCalled();
      });
    });

    describe("when an attribute is added with a new key", () => {
      /** @scenario "Adding an attribute with a key the span does not have records it" */
      it("records the addition", () => {
        const onEditAttribute = vi.fn();
        const { getByLabelText, getByRole } = renderEditable({
          onEditAttribute,
        });

        fireEvent.change(getByLabelText("New attribute name"), {
          target: { value: "review.note" },
        });
        fireEvent.change(getByLabelText("New attribute value"), {
          target: { value: "corrected by hand" },
        });
        fireEvent.click(getByRole("button", { name: "Add attribute" }));

        expect(onEditAttribute).toHaveBeenCalledWith({
          key: "review.note",
          value: "corrected by hand",
        });
      });
    });
  });

  describe("given an attribute the viewer is not allowed to read", () => {
    describe("when the attributes are being corrected", () => {
      /** @scenario "An attribute hidden from me carries no editor" */
      it("carries no editor for that attribute", () => {
        const { queryByLabelText, getByLabelText } = renderEditable({
          restrictedAttributes: [
            {
              pattern: "gen_ai.request.model",
              visibleTo: "Admins",
              canSee: false,
            },
          ],
        });

        expect(queryByLabelText("Edit gen_ai.request.model")).not.toBeInTheDocument();
        // The attributes the viewer can read are still editable.
        expect(getByLabelText("Edit gen_ai.request.temperature")).toBeInTheDocument();
      });
    });
  });

  describe("given a stored correction that changed an attribute", () => {
    function renderCorrected(
      attributes: Record<string, unknown>,
      correctedFrom: Record<string, unknown>,
    ) {
      return render(
        <ChakraProvider value={defaultSystem}>
          <AttributeTable attributes={attributes} correctedFrom={correctedFrom} />
        </ChakraProvider>,
      );
    }

    describe("when the span detail renders", () => {
      /** @scenario "A corrected attribute is highlighted and names its captured value" */
      it("marks the changed attribute and names the captured value", () => {
        const { getByLabelText, getByText } = renderCorrected(
          { "gen_ai.request.model": "gpt-5" },
          { "gen_ai.request.model": "gpt-5-mini" },
        );

        expect(getByText("Edited")).toBeInTheDocument();
        expect(
          getByLabelText("gen_ai.request.model, edited. Original: gpt-5-mini"),
        ).toBeInTheDocument();
      });

      /** @scenario "A corrected attribute is highlighted and names its captured value" */
      it("leaves attributes the correction did not touch unmarked", () => {
        const { queryByLabelText } = renderCorrected(
          { "gen_ai.request.model": "gpt-5-mini" },
          { "gen_ai.request.model": "gpt-5-mini" },
        );

        expect(queryByLabelText(/edited\. Original/)).not.toBeInTheDocument();
      });

      // A correction rewrites the whole attribute record, so an attribute
      // holding JSON comes back re-serialised whether or not anyone touched it.
      /** @scenario "JSON that only changed its formatting is not marked as edited" */
      it("leaves an attribute the correction only re-serialised unmarked", () => {
        const toolCalls = [
          {
            type: "tool-call",
            toolName: "bash",
            toolCallId: "call_VXJC9uzjpxa99ESxuMwQPEyF",
            input: { command: "langwatch trace search", timeout: 120000 },
          },
        ];

        const { queryByText } = renderCorrected(
          { "ai.response.toolCalls": JSON.stringify(toolCalls, null, 2) },
          { "ai.response.toolCalls": JSON.stringify(toolCalls) },
        );

        expect(queryByText("Edited")).not.toBeInTheDocument();
      });

      /** @scenario "JSON that only changed its formatting is not marked as edited" */
      it("still marks one whose content the correction changed", () => {
        const { getByText } = renderCorrected(
          { "ai.response.toolCalls": '[{"toolName":"read"}]' },
          { "ai.response.toolCalls": '[{"toolName":"bash"}]' },
        );

        expect(getByText("Edited")).toBeInTheDocument();
      });
    });
  });

  describe("given a stored correction that removed an attribute", () => {
    describe("when the corrected trace renders", () => {
      /** @scenario "An attribute the correction removes is listed struck through" */
      it("still lists it, marked as removed and struck through", () => {
        const { getByText, getByLabelText } = render(
          <ChakraProvider value={defaultSystem}>
            <AttributeTable
              attributes={{ "gen_ai.request.model": "gpt-5" }}
              correctedFrom={{
                "gen_ai.request.model": "gpt-5",
                "user.email": "someone@acme.test",
              }}
            />
          </ChakraProvider>,
        );

        expect(getByText("user.email")).toBeInTheDocument();
        expect(getByText("someone@acme.test")).toBeInTheDocument();
        expect(getByLabelText("user.email, removed by an edit")).toBeInTheDocument();
      });

      /** @scenario "An attribute the correction removes is listed struck through" */
      it("does not call the removal an edit", () => {
        const { queryByText } = render(
          <ChakraProvider value={defaultSystem}>
            <AttributeTable
              attributes={{ "gen_ai.request.model": "gpt-5" }}
              correctedFrom={{
                "gen_ai.request.model": "gpt-5",
                "user.email": "someone@acme.test",
              }}
            />
          </ChakraProvider>,
        );

        expect(queryByText("Edited")).not.toBeInTheDocument();
      });
    });

    describe("when the corrected span's attributes are copied", () => {
      /** @scenario "Copying the attributes leaves out the ones the correction removed" */
      it("hands on what the span carries, without the removed row", () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });
        const { getByLabelText } = render(
          <ChakraProvider value={defaultSystem}>
            <AttributeTable
              attributes={{ "gen_ai.request.model": "gpt-5" }}
              correctedFrom={{
                "gen_ai.request.model": "gpt-5",
                "user.email": "someone@acme.test",
              }}
            />
          </ChakraProvider>,
        );

        fireEvent.click(getByLabelText("Copy all attributes"));

        expect(writeText).toHaveBeenCalledTimes(1);
        const copied = JSON.parse(writeText.mock.calls[0]![0] as string);
        expect(copied).toEqual({ gen_ai: { request: { model: "gpt-5" } } });
      });
    });

    describe("when the captured trace renders", () => {
      /** @scenario "An attribute the correction removes reads plainly in the captured trace" */
      it("reads like any other row, with nothing said about the removal", () => {
        const { getByText, queryByText } = render(
          <ChakraProvider value={defaultSystem}>
            <AttributeTable
              attributes={{
                "gen_ai.request.model": "gpt-5",
                "user.email": "someone@acme.test",
              }}
            />
          </ChakraProvider>,
        );

        expect(getByText("user.email")).toBeInTheDocument();
        expect(queryByText("Removed")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a stored correction that added an attribute", () => {
    describe("when the span detail renders", () => {
      /** @scenario "An attribute the correction added is marked as added" */
      it("marks it as added by an edit", () => {
        const { getByLabelText } = render(
          <ChakraProvider value={defaultSystem}>
            <AttributeTable
              attributes={{ "review.note": "corrected by hand" }}
              correctedFrom={{}}
            />
          </ChakraProvider>,
        );

        expect(getByLabelText("review.note, added by an edit")).toBeInTheDocument();
      });
    });
  });

  describe("given an attribute the trace recorded as text", () => {
    const RECORDED = '{"tools":["search"],"retries":0}';

    describe("when the same document is typed into the editor", () => {
      /** @scenario "An attribute editor keeps the shape the trace recorded" */
      it("records it as text rather than as a structure", () => {
        const retyped = '{"tools": ["search"], "retries": 0}';
        const onEditAttribute = vi.fn();
        const { getByLabelText } = render(
          <ChakraProvider value={defaultSystem}>
            <AttributeTable
              attributes={{ "langwatch.params": RECORDED }}
              editing={{
                edits: {},
                onEditAttribute,
                onResetAttribute: vi.fn(),
              }}
            />
          </ChakraProvider>,
        );

        fireEvent.change(getByLabelText("Edit langwatch.params"), {
          target: { value: retyped },
        });

        expect(onEditAttribute).toHaveBeenCalledWith({
          key: "langwatch.params",
          value: retyped,
        });
      });
    });
  });

  describe("given a key the metadata rules keep read-only", () => {
    describe("when the attributes are being corrected", () => {
      /** @scenario "The keys that place a trace carry no metadata editor" */
      it("carries no editor and refuses to add it", () => {
        const onEditAttribute = vi.fn();
        const { queryByLabelText, getByLabelText, getByRole, getByText } = render(
          <ChakraProvider value={defaultSystem}>
            <AttributeTable
              attributes={{
                "metadata.environment": "staging",
                "gen_ai.conversation.id": "thread-1",
              }}
              editing={{
                edits: {},
                onEditAttribute,
                onResetAttribute: vi.fn(),
                isKeyEditable: (key) => key.startsWith("metadata."),
              }}
            />
          </ChakraProvider>,
        );

        expect(queryByLabelText("Edit gen_ai.conversation.id")).not.toBeInTheDocument();
        expect(getByLabelText("Edit metadata.environment")).toBeInTheDocument();

        fireEvent.change(getByLabelText("New attribute name"), {
          target: { value: "thread_id" },
        });
        fireEvent.click(getByRole("button", { name: "Add attribute" }));

        expect(getByText("This key can't be edited")).toBeInTheDocument();
        expect(onEditAttribute).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a correction that replaced a whole attribute record", () => {
    describe("when only one of its keys really changed", () => {
      /** @scenario "Only the attribute rows a correction really changed read as edited" */
      it("marks that key alone", () => {
        const { getAllByText, getByLabelText } = render(
          <ChakraProvider value={defaultSystem}>
            <AttributeTable
              attributes={{
                "gen_ai.request.model": "gpt-5",
                "gen_ai.request.temperature": 0.2,
              }}
              correctedFrom={{
                "gen_ai.request.model": "gpt-5-mini",
                "gen_ai.request.temperature": 0.2,
              }}
            />
          </ChakraProvider>,
        );

        expect(getAllByText("Edited")).toHaveLength(1);
        expect(
          getByLabelText("gen_ai.request.model, edited. Original: gpt-5-mini"),
        ).toBeInTheDocument();
      });
    });

    describe("when it turned a recorded text value into a structure", () => {
      /** @scenario "An attribute the correction unpacked from recorded text is not marked as added" */
      it("reads the rows underneath it as edited rather than added", () => {
        const { queryByLabelText, getByLabelText } = render(
          <ChakraProvider value={defaultSystem}>
            <AttributeTable
              attributes={{
                langwatch: { input: { type: "text", value: "hello" } },
              }}
              correctedFrom={{
                langwatch: { input: '{"type":"text","value":"hello"}' },
              }}
            />
          </ChakraProvider>,
        );

        expect(queryByLabelText(/added by an edit/)).not.toBeInTheDocument();
        expect(
          getByLabelText(
            'langwatch.input.type, edited. Original: {"type":"text","value":"hello"}',
          ),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given resource attributes", () => {
    describe("when the span attributes are being corrected", () => {
      it("leaves the resource attributes read-only", () => {
        const { queryByLabelText } = render(
          <ChakraProvider value={defaultSystem}>
            <AttributeTable
              attributes={CAPTURED}
              resourceAttributes={{ "service.name": "api" }}
              editing={{
                edits: {},
                onEditAttribute: vi.fn(),
                onResetAttribute: vi.fn(),
              }}
            />
          </ChakraProvider>,
        );

        expect(queryByLabelText("Edit service.name")).not.toBeInTheDocument();
      });
    });
  });
});
