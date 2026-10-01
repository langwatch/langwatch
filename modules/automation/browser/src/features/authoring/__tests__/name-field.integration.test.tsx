/**
 * @vitest-environment jsdom
 *
 * #6716: a blank name used to block Save with no visible reason. The error shows nowhere on an
 * untouched draft, and right on the field once the rest of the setup is done.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AutomationNameField } from "../ui/elements/name-field.tsx";

const renderField = ({ configComplete }: { configComplete: boolean }) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AutomationNameField
        source="trace"
        value=""
        isEdit={false}
        configComplete={configComplete}
        noun="automation"
        onChange={vi.fn()}
      />
    </ChakraProvider>,
  );

describe("AutomationNameField", () => {
  afterEach(cleanup);

  describe("given a brand-new, untouched draft", () => {
    it("does not show a name error yet", () => {
      renderField({ configComplete: false });

      expect(screen.queryByText(/name this/i)).not.toBeInTheDocument();
    });
  });

  describe("given every section is complete except the name", () => {
    /** @scenario "Saving without a name points at the name field" */
    it("shows the required-name error at the field", () => {
      renderField({ configComplete: true });

      expect(screen.getByText(/name this automation to save it/i)).toBeInTheDocument();
    });

    it("marks the name field invalid", () => {
      renderField({ configComplete: true });

      expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe("true");
    });
  });
});
