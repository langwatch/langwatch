/**
 * @vitest-environment jsdom
 *
 * Issue #5759: a custom model's configured Display Name never reaches
 * ProviderModelSelector — it rebuilds every item's label from the raw
 * Model ID via `value.split("/").slice(1).join("/")` and never reads
 * the provider's configured `displayName`. Same bug hits the inherit
 * entry's subtitle and the collapsed trigger's inherit placeholder.
 *
 * `ProviderModelSelector` does not yet accept a `displayNames` prop —
 * these tests are expected to fail (assertion, not import/type error at
 * runtime; `pnpm typecheck` additionally flags the unknown prop) until
 * issue #5759 is fixed.
 *
 * Query strategy: Select.Content (role="listbox") is mounted in the DOM
 * whether or not the dropdown is open (Ark/Chakra Select only toggles a
 * `hidden` attribute + `data-state`), so item labels are queryable via
 * `within(listbox).getByText(...)` without driving a click. Unscoped
 * `screen.getByText`/`queryByText` is unsafe here: Chakra's
 * `Select.HiddenSelect` mirrors every item as a native `<option>`
 * sibling, so any label also rendered in the real listbox produces a
 * "multiple elements found" error unless queries are scoped to the
 * listbox (for item text) or the trigger (for the collapsed value).
 *
 * @see specs/model-providers/custom-model-display-name.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderModelSelector } from "../ProviderModelSelector";

afterEach(() => cleanup());

function renderSelector(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

function listbox() {
  return screen.getByRole("listbox", { hidden: true });
}

function trigger() {
  return screen.getByRole("combobox");
}

function inheritItem() {
  return screen.getByTestId("provider-model-selector-inherit");
}

const MODEL_ID = "gpt-5.1";
const DISPLAY_NAME = "Ada Prod Model";
const PROVIDER = "custom";
const FULL_ID = `${PROVIDER}/${MODEL_ID}`;
const DISPLAY_NAMES = { [FULL_ID]: DISPLAY_NAME };

const EMBED_MODEL_ID = "text-embed-3";
const EMBED_DISPLAY_NAME = "Ada Prod Embed";
const EMBED_FULL_ID = `${PROVIDER}/${EMBED_MODEL_ID}`;
// One unified map carries both chat and embeddings entries — pins that
// buildCustomModelDisplayNames is not mode-gated (a single map serves
// every role's ProviderModelSelector instance, chat or embeddings).
const UNIFIED_DISPLAY_NAMES = {
  [FULL_ID]: DISPLAY_NAME,
  [EMBED_FULL_ID]: EMBED_DISPLAY_NAME,
};

describe("<ProviderModelSelector/>", () => {
  describe("given a custom model with a configured display name", () => {
    describe("when the dropdown lists its options", () => {
      /** @scenario Dropdown item shows the configured display name */
      it("renders the item's label as the display name", () => {
        renderSelector(
          <ProviderModelSelector
            model=""
            options={[FULL_ID]}
            onChange={vi.fn()}
            displayNames={DISPLAY_NAMES}
          />,
        );

        expect(within(listbox()).getByText(DISPLAY_NAME)).toBeInTheDocument();
      });

      it("does not render the raw model id as the item's label", () => {
        renderSelector(
          <ProviderModelSelector
            model=""
            options={[FULL_ID]}
            onChange={vi.fn()}
            displayNames={DISPLAY_NAMES}
          />,
        );

        expect(within(listbox()).queryByText(MODEL_ID)).not.toBeInTheDocument();
      });
    });

    describe("when the model is selected and the selector is collapsed", () => {
      /** @scenario Collapsed selector shows the configured display name */
      it("renders the trigger's value as the display name", () => {
        renderSelector(
          <ProviderModelSelector
            model={FULL_ID}
            options={[FULL_ID]}
            onChange={vi.fn()}
            displayNames={DISPLAY_NAMES}
          />,
        );

        expect(within(trigger()).getByText(DISPLAY_NAME)).toBeInTheDocument();
      });
    });

    describe("when the user picks the item from the dropdown", () => {
      /** @scenario Selecting a renamed model stores its model id */
      it("calls onChange with the model id, not the display name", async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        renderSelector(
          <ProviderModelSelector
            model=""
            options={[FULL_ID]}
            onChange={onChange}
            displayNames={DISPLAY_NAMES}
          />,
        );

        await user.click(trigger());
        await user.click(within(listbox()).getByText(DISPLAY_NAME));

        expect(onChange).toHaveBeenCalledWith(FULL_ID);
      });
    });

    describe("when the user searches by the display name", () => {
      /** @scenario Search by display name finds a renamed model */
      it("keeps the model listed", () => {
        renderSelector(
          <ProviderModelSelector
            model=""
            options={[FULL_ID]}
            onChange={vi.fn()}
            displayNames={DISPLAY_NAMES}
          />,
        );

        fireEvent.change(screen.getByPlaceholderText("Search models"), {
          target: { value: "Ada" },
        });

        expect(within(listbox()).getByText(DISPLAY_NAME)).toBeInTheDocument();
      });
    });

    describe("when the user searches by the raw model id", () => {
      /** @scenario Search by model id finds a renamed model */
      it("keeps the model listed, shown by its display name", () => {
        renderSelector(
          <ProviderModelSelector
            model=""
            options={[FULL_ID]}
            onChange={vi.fn()}
            displayNames={DISPLAY_NAMES}
          />,
        );

        fireEvent.change(screen.getByPlaceholderText("Search models"), {
          target: { value: MODEL_ID },
        });

        expect(within(listbox()).getByText(DISPLAY_NAME)).toBeInTheDocument();
      });
    });
  });

  describe("given the provider also has a custom embeddings model with a configured display name", () => {
    describe("when the embeddings role dropdown lists its options", () => {
      /** @scenario Custom embeddings model shows the configured display name */
      it("renders the embeddings item's label as its display name", () => {
        renderSelector(
          <ProviderModelSelector
            model=""
            options={[EMBED_FULL_ID]}
            onChange={vi.fn()}
            displayNames={UNIFIED_DISPLAY_NAMES}
          />,
        );

        expect(
          within(listbox()).getByText(EMBED_DISPLAY_NAME),
        ).toBeInTheDocument();
      });

      it("does not render the raw embeddings model id as the item's label", () => {
        renderSelector(
          <ProviderModelSelector
            model=""
            options={[EMBED_FULL_ID]}
            onChange={vi.fn()}
            displayNames={UNIFIED_DISPLAY_NAMES}
          />,
        );

        expect(
          within(listbox()).queryByText(EMBED_MODEL_ID),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given a provider with both a renamed custom model and registry models", () => {
    const options = [FULL_ID, `${PROVIDER}/gpt-4o-mini`, `${PROVIDER}/gpt-4o`];

    describe("when the dropdown lists its options", () => {
      /** @scenario Registry model labels are unchanged alongside a custom model */
      it("still shows the registry models by their id-derived labels", () => {
        renderSelector(
          <ProviderModelSelector
            model=""
            options={options}
            onChange={vi.fn()}
            displayNames={DISPLAY_NAMES}
          />,
        );

        expect(within(listbox()).getByText("gpt-4o-mini")).toBeInTheDocument();
        expect(within(listbox()).getByText("gpt-4o")).toBeInTheDocument();
      });

      it("shows the custom model by its display name", () => {
        renderSelector(
          <ProviderModelSelector
            model=""
            options={options}
            onChange={vi.fn()}
            displayNames={DISPLAY_NAMES}
          />,
        );

        expect(within(listbox()).getByText(DISPLAY_NAME)).toBeInTheDocument();
      });
    });
  });

  describe("given the role inherits the renamed custom model from a broader scope", () => {
    const inheritOption = {
      model: FULL_ID,
      label: "Inherit (from organization)",
    };

    describe("when the role dropdown offering the inherit entry is rendered", () => {
      /** @scenario Inherit entry shows the display name without replacing its own label */
      it("renders the inherit entry's subtitle as the display name", () => {
        renderSelector(
          <ProviderModelSelector
            model=""
            options={[FULL_ID]}
            onChange={vi.fn()}
            displayNames={DISPLAY_NAMES}
            inheritOption={inheritOption}
          />,
        );

        // Scoped to the inherit entry, not the whole listbox: the
        // inherited model is also a real option here, so both legitimately
        // render the display name and an unscoped getByText matches twice.
        expect(
          within(inheritItem()).getByText(DISPLAY_NAME),
        ).toBeInTheDocument();
      });

      it("renders the collapsed selector's placeholder as the display name", () => {
        renderSelector(
          <ProviderModelSelector
            model=""
            options={[FULL_ID]}
            onChange={vi.fn()}
            displayNames={DISPLAY_NAMES}
            inheritOption={inheritOption}
          />,
        );

        expect(within(trigger()).getByText(DISPLAY_NAME)).toBeInTheDocument();
      });

      it("leaves the inherit entry's own caller-supplied label untouched", () => {
        renderSelector(
          <ProviderModelSelector
            model=""
            options={[FULL_ID]}
            onChange={vi.fn()}
            displayNames={DISPLAY_NAMES}
            inheritOption={inheritOption}
          />,
        );

        expect(
          within(listbox()).getByText("Inherit (from organization)"),
        ).toBeInTheDocument();
      });
    });
  });
});
