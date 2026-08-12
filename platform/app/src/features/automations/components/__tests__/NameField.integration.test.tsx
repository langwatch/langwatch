/**
 * @vitest-environment jsdom
 *
 * #6716: leaving the name blank used to block Save with no visible reason on
 * the form itself — the only clue was a tooltip on the disabled Save button.
 * These tests pin where the missing-name error actually shows: nowhere on an
 * untouched draft (a fresh drawer shouldn't open looking broken), and right
 * on the field once the rest of the setup is otherwise done.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { TriggerAction } from "@prisma/client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INITIAL_DRAFT } from "../../logic/draftReducer";
import { useAutomationStore } from "../../state/automationStore";
import { NameField } from "../NameField";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const EMPTY_FIELD = { value: "", usingDefault: true };

describe("NameField", () => {
  beforeEach(() => {
    useAutomationStore.getState().reset();
  });
  afterEach(cleanup);

  describe("given a brand-new, untouched draft", () => {
    it("does not show a name error yet", () => {
      render(<NameField isEdit={false} />, { wrapper: Wrapper });

      expect(screen.queryByText(/name this/i)).not.toBeInTheDocument();
    });
  });

  describe("given every section is complete except the name", () => {
    beforeEach(() => {
      useAutomationStore.getState().hydrate({
        ...INITIAL_DRAFT,
        name: "",
        filterQuery: "status:error",
        action: TriggerAction.SEND_EMAIL,
        slices: {
          ...INITIAL_DRAFT.slices,
          [TriggerAction.SEND_EMAIL]: {
            members: ["a@acme.test"],
            subject: EMPTY_FIELD,
            body: EMPTY_FIELD,
          },
        },
      });
    });

    /** @scenario "Saving without a name points at the name field" */
    it("shows the required-name error at the field", () => {
      render(<NameField isEdit={false} />, { wrapper: Wrapper });

      expect(
        screen.getByText(/name this automation to save it/i),
      ).toBeInTheDocument();
    });

    it("marks the name field invalid", () => {
      render(<NameField isEdit={false} />, { wrapper: Wrapper });

      const input = screen.getByDisplayValue("");
      expect(input.getAttribute("aria-invalid")).toBe("true");
    });
  });
});
