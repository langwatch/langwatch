/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

import { AttributeTable } from "../AttributeTable";

function renderTable() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AttributeTable
        spanId="span-abc123"
        attributes={{ "gen_ai.operation.name": "chat" }}
      />
    </ChakraProvider>,
  );
}

describe("AttributeTable", () => {
  afterEach(cleanup);

  describe("given a synthetic span_id row", () => {
    describe("when the attribute table is rendered", () => {
      it("shows a disabled, non-button pin instead of a blank gap", () => {
        const { getByLabelText } = renderTable();

        const disabledPin = getByLabelText("span_id can't be pinned");
        expect(disabledPin).toBeInTheDocument();
        expect(disabledPin).toHaveAttribute("aria-disabled", "true");
        // It must NOT be an actionable pin toggle.
        expect(disabledPin.tagName).not.toBe("BUTTON");
      });

      it("still renders a real pin toggle for an actual attribute", () => {
        const { getByRole } = renderTable();

        expect(
          getByRole("button", { name: /pin gen_ai\.operation\.name/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given a custom attribute under a restrict rule", () => {
    function renderWithRestriction(canSee: boolean) {
      return render(
        <ChakraProvider value={defaultSystem}>
          <AttributeTable
            attributes={{ "app.billing.plan": "pro", "service.name": "api" }}
            restrictedAttributes={[
              { pattern: "app.billing.*", visibleTo: "Admins", canSee },
            ]}
          />
        </ChakraProvider>,
      );
    }

    describe("when the viewer is in the audience", () => {
      it("marks the matching row as visible to that audience", () => {
        const { getByLabelText } = renderWithRestriction(true);

        expect(
          getByLabelText("Restricted attribute, visible to Admins"),
        ).toBeInTheDocument();
      });
    });

    describe("when the viewer is outside the audience", () => {
      it("marks the matching row as hidden", () => {
        const { getByLabelText } = renderWithRestriction(false);

        expect(
          getByLabelText("Restricted attribute, hidden, visible to Admins"),
        ).toBeInTheDocument();
      });
    });

    it("leaves attributes that match no rule unmarked", () => {
      const { queryByLabelText } = renderWithRestriction(true);

      // service.name does not match `app.billing.*`, so it gets no marker.
      expect(queryByLabelText(/^Restricted attribute/)).toBeInTheDocument();
      const markers = document.querySelectorAll(
        '[aria-label^="Restricted attribute"]',
      );
      expect(markers).toHaveLength(1);
    });
  });
});
