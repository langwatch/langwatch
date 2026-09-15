/**
 * @vitest-environment jsdom
 *
 * Tests controlled textarea: keystrokes reach draft state, updating matched-traces count.
 * Autocomplete pending suggestion surface (see dev/docs/plans/ui-family-move-manifests.md).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryFilterInput } from "../ui/elements/query-filter-input.tsx";

function Harness({
  initial = "",
  onChange,
}: {
  initial?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ChakraProvider value={defaultSystem}>
      <QueryFilterInput
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        placeholder="query"
      />
    </ChakraProvider>
  );
}

const textbox = () => screen.getByRole("textbox") as HTMLTextAreaElement;

afterEach(cleanup);

describe("QueryFilterInput", () => {
  describe("when the author types a query", () => {
    it("reports every keystroke to its owner", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);

      await user.click(textbox());
      await user.type(textbox(), "status:error");

      expect(textbox().value).toBe("status:error");
      expect(onChange).toHaveBeenLastCalledWith("status:error");
    });
  });

  describe("given a query the automation was saved with", () => {
    it("shows it, so an edit starts from what is stored", () => {
      render(<Harness initial="model:gpt*" />);

      expect(textbox().value).toBe("model:gpt*");
    });
  });
});
