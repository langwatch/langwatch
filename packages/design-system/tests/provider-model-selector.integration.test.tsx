/**
 * @vitest-environment jsdom
 * Queries scope to the listbox or trigger because `Select.HiddenSelect` mirrors every item as a
 * native `<option>` too. Binds specs/model-providers/custom-model-display-name.feature and
 * specs/model-providers/model-default-config-cascade.feature.
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INHERIT_SENTINEL,
  ProviderModelSelector,
  type ModelPickerOption,
} from "../src/components/provider-model-selector.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

// jsdom has no Element.scrollTo, which the select machine calls when an item is picked.
Element.prototype.scrollTo = () => undefined;

afterEach(() => cleanup());

const CUSTOM: ModelPickerOption = {
  label: "Ada Prod Model",
  value: "custom/gpt-5.1",
};
const MINI: ModelPickerOption = { label: "gpt-5-mini", value: "custom/gpt-5-mini" };
const LATEST: ModelPickerOption = {
  label: "Latest",
  value: "openai/latest",
  subtitle: "openai/gpt-5.2",
};

function renderSelector({
  options,
  ...props
}: { options: ModelPickerOption[] } & Partial<Parameters<typeof ProviderModelSelector>[0]>) {
  return renderWithDesignSystem(
    <ProviderModelSelector
      model=""
      query={{ data: options, isLoading: false }}
      onChange={vi.fn()}
      {...props}
    />,
  );
}

const listbox = () => screen.getByRole("listbox", { hidden: true });
const trigger = () => screen.getByRole("combobox");

describe("<ProviderModelSelector/>", () => {
  describe("given an option with a configured display name", () => {
    it("lists the item by its label, not the raw model id", () => {
      renderSelector({ options: [CUSTOM] });

      expect(within(listbox()).queryByText("Ada Prod Model")).not.toBeNull();
      expect(within(listbox()).queryByText("gpt-5.1")).toBeNull();
    });

    it("shows the label in the collapsed trigger when it is selected", () => {
      renderSelector({ options: [CUSTOM], model: CUSTOM.value });

      expect(within(trigger()).queryByText("Ada Prod Model")).not.toBeNull();
    });

    it("calls onChange with the model id, not the label", async () => {
      const onChange = vi.fn();
      renderSelector({ options: [CUSTOM], onChange });

      await userEvent.setup().click(trigger());
      await userEvent.setup().click(within(listbox()).getByText("Ada Prod Model"));

      expect(onChange).toHaveBeenCalledWith(CUSTOM.value);
    });

    it("keeps the item listed when the search matches the label", () => {
      renderSelector({ options: [CUSTOM] });

      fireEvent.change(screen.getByPlaceholderText("Search models"), { target: { value: "Ada" } });

      expect(within(listbox()).queryByText("Ada Prod Model")).not.toBeNull();
    });

    it("keeps the item listed when the search matches the raw model id", () => {
      renderSelector({ options: [CUSTOM] });

      fireEvent.change(screen.getByPlaceholderText("Search models"), {
        target: { value: "gpt-5.1" },
      });

      expect(within(listbox()).queryByText("Ada Prod Model")).not.toBeNull();
    });
  });

  describe("given registry options beside a renamed one", () => {
    it("lists every option by its own label", () => {
      renderSelector({ options: [CUSTOM, MINI] });

      expect(within(listbox()).queryByText("gpt-5-mini")).not.toBeNull();
      expect(within(listbox()).queryByText("Ada Prod Model")).not.toBeNull();
    });
  });

  describe("given an alias option with a resolved subtitle", () => {
    it("shows the alias label with the resolved model under it", () => {
      renderSelector({ options: [LATEST] });

      expect(within(listbox()).queryByText("Latest")).not.toBeNull();
      expect(within(listbox()).queryByText("openai/gpt-5.2")).not.toBeNull();
    });
  });

  describe("given a saved model that is not among the options", () => {
    it("labels it through labelFor", () => {
      renderSelector({ options: [MINI], model: "gone/old-model", labelFor: () => "Old model" });

      expect(within(trigger()).queryByText("Old model")).not.toBeNull();
    });
  });

  describe("given an inherit entry", () => {
    const inheritOption = { model: CUSTOM.value, label: "Inherit (from organization)" };

    it("renders the inherit row without a Cascade group label", () => {
      renderSelector({ options: [CUSTOM], inheritOption });

      expect(screen.getAllByText("Inherit (from organization)").length).toBeGreaterThan(0);
      expect(screen.queryByText(/cascade/i)).toBeNull();
    });

    it("names the inherited model through labelFor in the row and the placeholder", () => {
      renderSelector({ options: [CUSTOM], inheritOption, labelFor: () => "Ada Prod Model" });

      const row = screen.getByTestId("provider-model-selector-inherit");
      expect(within(row).queryByText("Ada Prod Model")).not.toBeNull();
      expect(within(trigger()).queryByText("Ada Prod Model")).not.toBeNull();
    });

    it("exports a sentinel the parent can compare against", () => {
      expect(INHERIT_SENTINEL.length).toBeGreaterThan(0);
    });
  });
});
