/**
 * @vitest-environment jsdom
 * Regression for #5759: ModelChip used to rebuild its label from the raw model id, ignoring the
 * configured custom-model display name. `displayNames` is optional, so dropping it at a call site
 * would compile silently — these tests are what makes that fail instead.
 * @see specs/model-providers/custom-model-display-name.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ModelChip } from "../model-chip.tsx";

afterEach(() => cleanup());

function renderChip(ui: ReactElement) {
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
        renderChip(<ModelChip model={FULL_ID} displayNames={{ [FULL_ID]: DISPLAY_NAME }} />);

        expect(screen.getByText(DISPLAY_NAME)).toBeInTheDocument();
      });

      it("does not read the raw model id", () => {
        renderChip(<ModelChip model={FULL_ID} displayNames={{ [FULL_ID]: DISPLAY_NAME }} />);

        expect(screen.queryByText(MODEL_ID)).not.toBeInTheDocument();
      });
    });

    describe("when the role's saved model has no entry in the displayNames map", () => {
      it("falls back to the model id's family part, unchanged from today", () => {
        renderChip(
          <ModelChip model="openai/gpt-5-mini" displayNames={{ [FULL_ID]: DISPLAY_NAME }} />,
        );

        expect(screen.getByText("gpt-5-mini")).toBeInTheDocument();
      });
    });

    describe("when a display name is configured against a `latest` alias id", () => {
      const ALIAS_ID = "openai/latest";

      it("still picks the alias label from the id, not the display name", () => {
        renderChip(<ModelChip model={ALIAS_ID} displayNames={{ [ALIAS_ID]: "My Latest" }} />);

        expect(screen.getByText("Latest")).toBeInTheDocument();
        expect(screen.queryByText("Latest smaller")).not.toBeInTheDocument();
      });
    });
  });
});
