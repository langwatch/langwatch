/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RestrictedAttribute } from "~/server/api/routers/tracesV2.schemas";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

import { type AttributeEditing, AttributeTable } from "../AttributeTable";

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

    describe("when an attribute is added with a new key", () => {
      /** @scenario "Adding an attribute rejects a key that already exists" */
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

        expect(
          queryByLabelText("Edit gen_ai.request.model"),
        ).not.toBeInTheDocument();
        // The attributes the viewer can read are still editable.
        expect(
          getByLabelText("Edit gen_ai.request.temperature"),
        ).toBeInTheDocument();
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
          <AttributeTable
            attributes={attributes}
            correctedFrom={correctedFrom}
          />
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

        expect(
          getByLabelText("review.note, added by an edit"),
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
