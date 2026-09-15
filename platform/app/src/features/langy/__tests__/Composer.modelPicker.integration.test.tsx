/**
 * @vitest-environment jsdom
 *
 * The Langy composer is one integrated surface: the field with send / stop
 * beside it, and the reused ModelSelector on the rail below, all inside a
 * single rounded card. This test pins that structure — the picker is always
 * visible (no collapse-on-hover), and the send control swaps to a stop control
 * while Langy is working.
 *
 * "Working" comes from the store's turn phase (ADR-078), the composer's single
 * source for the send/stop affordance — there is no `isBusy` prop.
 *
 * The shared model-option hook is mocked at its module boundary so the test
 * stays about the composer's rail, not the project-provider query.
 *
 * @see specs/langy/langy-model-selection.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent, {
  PointerEventsCheckLevel,
} from "@testing-library/user-event";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { useLangyStore } from "../stores/langyStore";

vi.mock("~/components/ModelSelector", () => ({
  ModelSelector: ({ model }: { model: string }) => (
    <div data-testid="model-selector">{model}</div>
  ),
  useModelSelectionOptions: (options: string[], model: string) => ({
    selectOptions: options.map((value) => ({
      value,
      label: value.split("/").slice(1).join("/"),
      isCustom: false,
    })),
    modelOption: options.includes(model)
      ? {
          value: model,
          label: model.split("/").slice(1).join("/"),
          isCustom: false,
        }
      : undefined,
  }),
}));
vi.mock("~/features/traces-v2/components/ai/useTypewriterPlaceholder", () => ({
  useTypewriterPlaceholder: () => "Ask Langy…",
}));

import { Composer } from "../components/Composer";

const TURN_ACTIVE_HINT =
  "Langy is working. You can switch models when it stops.";

function renderComposer(
  overrides: Partial<{
    model: string;
    modelOptions: string[];
    disabled: boolean;
  }> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Composer
        model={overrides.model ?? "openai/gpt-5-mini"}
        modelOptions={overrides.modelOptions ?? ["openai/gpt-5-mini"]}
        onModelChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        disabled={overrides.disabled ?? false}
      />
    </ChakraProvider>,
  );
}

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

const resetPhase = () =>
  useLangyStore.setState({ turnPhase: "idle", draft: "" });

beforeEach(resetPhase);
afterEach(() => {
  cleanup();
  resetPhase();
});

describe("given the integrated Langy composer", () => {
  describe("when idle", () => {
    it("renders the reused model picker and a send control on the bottom rail", () => {
      renderComposer();

      const picker = screen.getByTestId("langy-model-picker");
      expect(picker.getAttribute("data-model")).toBe("openai/gpt-5-mini");
      expect(picker.getAttribute("aria-label")).toBe("Model: gpt-5-mini");
      expect(screen.getByLabelText("Send")).toBeTruthy();
    });

    it("opens the model menu when the pill is clicked", async () => {
      const user = userEvent.setup();

      renderComposer();

      const picker = screen.getByTestId("langy-model-picker");
      await user.click(picker);

      await waitFor(() => {
        expect(picker.getAttribute("data-state")).toBe("open");
      });
      expect(
        screen.getByPlaceholderText("Search models").hasAttribute("disabled"),
      ).toBe(false);
    });
  });

  describe("when Langy is working", () => {
    it("swaps the send control for a stop control", () => {
      // The composer reads the durable turn-phase machine, not a busy prop —
      // drive it the way the panel does when the server accepts a turn.
      useLangyStore
        .getState()
        .beginTurn({ conversationId: "conv-1", turnId: "turn-1" });

      renderComposer();

      expect(screen.getByLabelText("Stop")).toBeTruthy();
      expect(screen.queryByLabelText("Send")).toBeNull();
    });

    /** @scenario "The model in use stays visible while Langy is working" */
    it("names the model on hover and says the picker unlocks when the turn stops", async () => {
      const user = userEvent.setup();
      useLangyStore
        .getState()
        .beginTurn({ conversationId: "conv-1", turnId: "turn-1" });

      renderComposer();

      const picker = screen.getByTestId("langy-model-picker");
      // A natively disabled button takes no pointer events, and a trigger the
      // pointer never reaches never explains itself. The turn lock is worn as
      // aria-disabled instead, so the pill stays hoverable and focusable.
      expect(picker.getAttribute("aria-disabled")).toBe("true");
      expect(picker.hasAttribute("disabled")).toBe(false);
      // And it can still take focus, which a natively disabled button cannot:
      // the composer's `/model` command focuses this very button.
      picker.focus();
      expect(document.activeElement).toBe(picker);

      await user.hover(picker);

      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip.textContent).toContain("OpenAI · gpt-5-mini");
      expect(tooltip.textContent).toContain(TURN_ACTIVE_HINT);

      // Saying which model runs does not hand the picker back.
      await user.click(picker);
      expect(picker.getAttribute("data-state")).toBe("closed");
    });
  });

  describe("when the composer is disabled for another reason", () => {
    it("promises no switch on hover, because no turn is about to stop", async () => {
      // A lock with no turn behind it keeps the native disabled attribute, so
      // the pointer never reaches the pill at all. The check is turned off to
      // prove the stronger thing: even a pointer that did reach it is told
      // nothing about a turn that is not running.
      const user = userEvent.setup({
        pointerEventsCheck: PointerEventsCheckLevel.Never,
      });

      renderComposer({ disabled: true });

      const picker = screen.getByTestId("langy-model-picker");
      expect(picker.hasAttribute("disabled")).toBe(true);

      await user.hover(picker);

      expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });

  describe("when model options have not arrived", () => {
    it("keeps a visible loading label and a real placeholder icon", () => {
      renderComposer({ model: "", modelOptions: [] });

      const picker = screen.getByTestId("langy-model-picker");
      expect(picker.getAttribute("data-loading")).toBe("true");
      expect(picker.getAttribute("aria-label")).toBe(
        "Model: Models are still loading…",
      );
    });
  });
});
