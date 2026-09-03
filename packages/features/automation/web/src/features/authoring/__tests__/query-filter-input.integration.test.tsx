/**
 * @vitest-environment jsdom
 *
 * WHAT THIS FILE LOST IN THE MOVE. It was three scenarios about the trace-query
 * autocomplete: a partial field name surfacing its label and accepting with a
 * colon, a typed field offering its values and accepting with a space, and
 * Escape closing the list without touching the query. All three drove the
 * traces view's suggestion dropdown, which lives in
 * `platform/app/src/features/traces-v2` — another feature's presentation, which
 * this package may not import and would not copy. `@langwatch/trace-web`
 * publishes the suggestion ENGINE and no surface that renders it, so the editor
 * here is a plain controlled textarea and those three scenarios are unbound
 * until that surface exists. Recorded in
 * `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * What is left to pin is what the fallback still guarantees, and it is not
 * nothing: the field is controlled, so every keystroke reaches the draft rather
 * than being held in the DOM, which is what makes the Subject facet's live
 * matched-traces count follow what the author typed.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryFilterInput } from "../ui/elements/query-filter-input";

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
