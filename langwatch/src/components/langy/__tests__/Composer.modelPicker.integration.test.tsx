/**
 * @vitest-environment jsdom
 *
 * Regression test for the Langy composer's per-send model picker.
 *
 * The model dropdown's popover is portaled to <body> (a sibling of the
 * picker wrapper, not a descendant). So moving the mouse from the pill
 * toward the option list fires `mouseleave` on the wrapper. The composer
 * must NOT collapse the picker while the dropdown is open — otherwise it
 * closes the dropdown the instant the user reaches for it, making the model
 * unselectable by mouse. This mirrors the portal-aware `onBlur` guard that
 * already existed for the focus path.
 *
 * ModelSelector is mocked at its module boundary so the test can control the
 * dropdown's open state and observe whether a later `mouseleave` closed it,
 * without dragging the real Chakra Select portal into jsdom.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Controllable ModelSelector: a button opens the dropdown (onOpenChange(true));
// the current `open` prop is surfaced so the test can assert whether a
// subsequent mouseleave closed it.
vi.mock("~/components/ModelSelector", () => ({
  ModelSelector: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
  }) => (
    <div>
      <button data-testid="ms-open-trigger" onClick={() => onOpenChange(true)}>
        open
      </button>
      <span data-testid="ms-open-state">{String(open)}</span>
    </div>
  ),
}));

// Brand visuals pull in WebGL shaders that don't run in jsdom.
vi.mock("~/features/traces-v2/components/ai/aiBrandVisuals", () => ({
  AI_BG_SUBTLE: "transparent",
  AI_BORDER: "transparent",
  AI_SHADOW: "none",
  MeshGradientLayer: () => null,
}));
vi.mock("~/features/traces-v2/components/ai/useTypewriterPlaceholder", () => ({
  useTypewriterPlaceholder: () => "Ask Langy…",
}));
// A truthy provider icon so the picker renders (it's visibility:hidden until
// the selected model resolves to a known provider).
vi.mock("~/server/modelProviders/iconsMap", () => ({
  modelProviderIcons: { openai: <svg data-testid="provider-icon" /> },
}));

import { Composer } from "../Composer";

function renderComposer() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Composer
        input=""
        onInputChange={() => {}}
        model="openai/gpt-5-mini"
        modelOptions={["openai/gpt-5-mini"]}
        onModelChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        isBusy={false}
        disabled={false}
        canSend={false}
      />
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("given the Langy model picker dropdown is open", () => {
  describe("when the pointer leaves the picker wrapper toward the portaled option list", () => {
    it("keeps the dropdown open", () => {
      renderComposer();
      const wrapper = screen.getByTestId("langy-model-picker");

      // Hover expands the pill; then open the dropdown.
      fireEvent.mouseEnter(wrapper);
      fireEvent.click(screen.getByTestId("ms-open-trigger"));
      expect(screen.getByTestId("ms-open-state").textContent).toBe("true");

      // Moving the mouse off the wrapper (toward the portaled popover) must
      // NOT collapse the picker or close the dropdown. Pre-fix, mouseleave
      // called collapsePicker() -> setPickerDropdownOpen(false).
      fireEvent.mouseLeave(wrapper);
      expect(screen.getByTestId("ms-open-state").textContent).toBe("true");
    });
  });
});

describe("given the Langy model picker dropdown is closed", () => {
  describe("when the pointer leaves the picker wrapper", () => {
    it("does not error and leaves the dropdown closed", () => {
      renderComposer();
      const wrapper = screen.getByTestId("langy-model-picker");

      fireEvent.mouseEnter(wrapper);
      expect(screen.getByTestId("ms-open-state").textContent).toBe("false");

      fireEvent.mouseLeave(wrapper);
      expect(screen.getByTestId("ms-open-state").textContent).toBe("false");
    });
  });
});
