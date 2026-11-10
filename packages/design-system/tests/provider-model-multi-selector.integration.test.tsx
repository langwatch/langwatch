/**
 * @vitest-environment jsdom
 * Queries scope to the listbox or trigger because `Select.HiddenSelect` mirrors every item as a
 * native `<option>` too.
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderModelMultiSelector } from "../src/components/scope/provider-model-multi-selector.tsx";
import type { ModelPickerOption } from "../src/components/scope/provider-model-selector.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

// jsdom has no Element.scrollTo, which the select machine calls when an item is picked.
Element.prototype.scrollTo = () => undefined;

afterEach(() => cleanup());

const MINI: ModelPickerOption = { label: "gpt-5-mini", value: "openai/gpt-5-mini" };
const FULL: ModelPickerOption = { label: "gpt-5", value: "openai/gpt-5" };

function renderSelector(props: Partial<Parameters<typeof ProviderModelMultiSelector>[0]> = {}) {
  return renderWithDesignSystem(
    <ProviderModelMultiSelector
      models={[]}
      emptyLabel="Every model"
      query={{ data: [MINI, FULL], isLoading: false }}
      onChange={vi.fn()}
      {...props}
    />,
  );
}

/** The drawn list; a multiple select's hidden native `<select>` is a listbox too. */
const listbox = () =>
  screen.getAllByRole("listbox", { hidden: true }).find((node) => node.tagName !== "SELECT")!;
const trigger = () => screen.getByRole("combobox");

describe("<ProviderModelMultiSelector/>", () => {
  describe("given nothing picked", () => {
    it("says what an empty pick means", () => {
      renderSelector();

      expect(within(trigger()).queryByText("Every model")).not.toBeNull();
    });
  });

  describe("given one model picked", () => {
    it("adds a second pick to the first", async () => {
      const onChange = vi.fn();
      renderSelector({ models: [MINI.value], onChange });

      await userEvent.setup().click(trigger());
      await userEvent.setup().click(within(listbox()).getByText(FULL.label));

      expect(onChange).toHaveBeenCalledWith([MINI.value, FULL.value]);
    });

    it("drops a picked model when it is picked again", async () => {
      const onChange = vi.fn();
      renderSelector({ models: [MINI.value, FULL.value], onChange });

      await userEvent.setup().click(trigger());
      await userEvent.setup().click(within(listbox()).getByText(MINI.label));

      expect(onChange).toHaveBeenCalledWith([FULL.value]);
    });

    it("keeps the picks hidden by a search when another is added", async () => {
      const onChange = vi.fn();
      renderSelector({ models: [MINI.value], onChange });

      await userEvent.setup().click(trigger());
      fireEvent.change(screen.getByPlaceholderText("Search models"), {
        target: { value: "openai/gpt-5" },
      });
      const rows = within(listbox()).getAllByRole("option", { hidden: true });
      const full = rows.find((row) => row.getAttribute("data-value") === FULL.value);
      await userEvent.setup().click(full!);

      expect(onChange).toHaveBeenCalledWith([MINI.value, FULL.value]);
    });
  });

  describe("given a picked model no option offers any more", () => {
    it("still lists it, marked, so it can be unpicked", () => {
      renderSelector({ models: ["mistral/mistral-large"] });

      expect(within(listbox()).queryByText("mistral/mistral-large")).not.toBeNull();
      expect(within(listbox()).queryByText("Not connected")).not.toBeNull();
    });
  });
});
