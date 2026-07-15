/**
 * @vitest-environment jsdom
 *
 * Issue #5759: ModelChip (the Default Models table's per-role model
 * pill) rebuilds its label from the raw model id via
 * `model.split("/").slice(1).join("/")` and never reads the provider's
 * configured custom-model display name.
 *
 * `ModelChip` does not yet accept a `displayNames` prop — these tests
 * are expected to fail on the rendered label until issue #5759 is fixed.
 *
 * @see specs/model-providers/custom-model-display-name.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ModelChip } from "../ModelChip";

afterEach(() => cleanup());

function renderChip(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

const MODEL_ID = "gpt-5.1";
const DISPLAY_NAME = "Ada Prod Model";
const FULL_ID = `custom/${MODEL_ID}`;

describe("<ModelChip/>", () => {
  describe("given the Default Models table with no editor open", () => {
    describe("when the role's saved model is a renamed custom model", () => {
      /** @scenario Default models table chip shows the configured display name */
      it("reads the configured display name", () => {
        renderChip(
          <ModelChip
            model={FULL_ID}
            displayNames={{ [FULL_ID]: DISPLAY_NAME }}
          />,
        );

        expect(screen.getByText(DISPLAY_NAME)).toBeInTheDocument();
      });

      it("does not read the raw model id", () => {
        renderChip(
          <ModelChip
            model={FULL_ID}
            displayNames={{ [FULL_ID]: DISPLAY_NAME }}
          />,
        );

        expect(screen.queryByText(MODEL_ID)).not.toBeInTheDocument();
      });
    });

    describe("when the role's saved model has no entry in the displayNames map", () => {
      it("falls back to the model id's family part, unchanged from today", () => {
        renderChip(
          <ModelChip
            model="openai/gpt-4o-mini"
            displayNames={{ [FULL_ID]: DISPLAY_NAME }}
          />,
        );

        expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();
      });
    });

    describe("when a display name is configured against a `latest` alias id", () => {
      const ALIAS_ID = "openai/latest";

      it("still picks the alias label from the id, not the display name", () => {
        renderChip(
          <ModelChip
            model={ALIAS_ID}
            displayNames={{ [ALIAS_ID]: "My Latest" }}
          />,
        );

        expect(screen.getByText("Latest")).toBeInTheDocument();
        expect(screen.queryByText("Latest smaller")).not.toBeInTheDocument();
      });
    });
  });
});
