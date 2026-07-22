/**
 * @vitest-environment jsdom
 *
 * The composer has two palettes and one keystroke each: `#` for CONTEXT (the
 * things on this page Langy could be given) and `/` for SKILLS (the things
 * Langy knows how to do). Both were reachable only by guessing the key, and
 * both opened a bar that looked identical, so this pins the two corrections:
 * the rail names each key and opens its palette on click, and the open palette
 * says which one it is.
 *
 * Also pins the one-time gesture hint, whose whole value is that it appears
 * once — a hint that comes back after you dismiss it is an ad.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/ModelSelector", () => ({
  ModelSelector: ({ model }: { model: string }) => (
    <div data-testid="model-selector">{model}</div>
  ),
  useModelSelectionOptions: (options: string[], model: string) => ({
    selectOptions: options.map((value) => ({
      value,
      label: value,
      isCustom: false,
    })),
    modelOption: options.includes(model)
      ? { value: model, label: model, isCustom: false }
      : undefined,
  }),
}));

import { Composer } from "../components/Composer";
import { LangyContextTargetLayer } from "../components/LangyContextTargetLayer";
import { useLangyContextTarget } from "../hooks/useLangyContextTarget";
import {
  type LangyContextTarget,
  useLangyContextTargetStore,
} from "../stores/langyContextTargetStore";
import { useLangyStore } from "../stores/langyStore";

function renderComposer() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Composer
        model="openai/gpt-5-mini"
        modelOptions={["openai/gpt-5-mini"]}
        onModelChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        disabled={false}
      />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  useLangyStore.setState({
    turnPhase: "idle",
    draft: "",
    contextHintDismissed: true,
    isOpen: false,
  });
  useLangyContextTargetStore.getState().reset();
});

afterEach(() => {
  cleanup();
  useLangyContextTargetStore.getState().reset();
});

describe("given the Langy composer", () => {
  describe("when the user has not yet found either palette", () => {
    it("names the key that opens context and the key that opens skills", () => {
      renderComposer();

      expect(
        screen.getByRole("button", { name: /press #/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /press \//i }),
      ).toBeInTheDocument();
    });
  });

  describe("when the user clicks the context key on the rail", () => {
    it("opens the context palette, titled", async () => {
      const user = userEvent.setup();
      renderComposer();

      await user.click(screen.getByRole("button", { name: /press #/i }));

      expect(screen.getByTestId("langy-palette-title")).toHaveTextContent(
        "Context",
      );
      expect(
        screen.getByPlaceholderText(/reference something on this page/i),
      ).toBeInTheDocument();
    });
  });

  describe("when the user clicks the skills key on the rail", () => {
    it("opens the skills palette, titled", async () => {
      const user = userEvent.setup();
      renderComposer();

      await user.click(screen.getByRole("button", { name: /press \//i }));

      expect(screen.getByTestId("langy-palette-title")).toHaveTextContent(
        "Skills",
      );
      expect(screen.getByPlaceholderText(/pick a skill/i)).toBeInTheDocument();
    });
  });

  describe("when the user types the trigger key at the start of a message", () => {
    it("opens the skills palette and does not type the slash", async () => {
      const user = userEvent.setup();
      renderComposer();

      await user.click(screen.getByRole("textbox"));
      await user.keyboard("/");

      expect(screen.getByTestId("langy-palette-title")).toHaveTextContent(
        "Skills",
      );
      expect(useLangyStore.getState().draft).toBe("");
    });
  });

  describe("when the user types a slash mid-sentence", () => {
    it("leaves the message alone — no palette", async () => {
      const user = userEvent.setup();
      renderComposer();

      await user.click(screen.getByRole("textbox"));
      await user.keyboard("http:/");

      expect(screen.queryByPlaceholderText(/pick a skill/i)).toBeNull();
      expect(useLangyStore.getState().draft).toBe("http:/");
    });
  });
});

describe("given a chip in the panel and its card on the page", () => {
  const chip = {
    id: "workflow:wf_1",
    kind: "workflow" as const,
    label: "workflow: checkout",
    ref: "wf_1",
  };

  /**
   * The card, rendered THROUGH the hook every page uses.
   *
   * Hand-building `<div data-langy-target="…">` here is what hid the bug this
   * pins: production emits that attribute from exactly one place, and it used to
   * withhold it unless the page was armed — so the spotlight had nothing to find
   * in the only state it is ever used from, while these tests happily passed
   * against markup the app never rendered.
   */
  function WorkflowCard({ target }: { target: LangyContextTarget }) {
    const langy = useLangyContextTarget(target);
    return <div {...langy.targetProps}>{target.label}</div>;
  }

  function renderPageAndLayer() {
    useLangyStore.setState({ isOpen: true });
    return render(
      <ChakraProvider value={defaultSystem}>
        {/* The page: not armed, not revealed — exactly how a user reading the
            panel's context list finds it. */}
        <WorkflowCard target={chip} />
        <LangyContextTargetLayer />
      </ChakraProvider>,
    );
  }

  describe("when nobody is pointing at the chip", () => {
    it("leaves the page alone", () => {
      renderPageAndLayer();

      expect(screen.queryByTestId("langy-target-spotlight")).toBeNull();
    });
  });

  describe("when the user points at the chip in the panel", () => {
    it("shines a light on the card, where the card actually is", () => {
      renderPageAndLayer();

      act(() => useLangyContextTargetStore.getState().setSpotlight(chip.id));

      const light = screen.getByTestId("langy-target-spotlight");
      expect(light).toBeInTheDocument();
      // Over the card, not somewhere near it.
      expect(light).toHaveStyle({ position: "fixed" });
    });

    it("takes the light away again when the pointer moves on", () => {
      renderPageAndLayer();
      act(() => useLangyContextTargetStore.getState().setSpotlight(chip.id));
      expect(screen.getByTestId("langy-target-spotlight")).toBeInTheDocument();

      act(() => useLangyContextTargetStore.getState().setSpotlight(null));

      expect(screen.queryByTestId("langy-target-spotlight")).toBeNull();
    });
  });

  describe("when the panel is closed", () => {
    it("shines nothing, whatever the store still remembers", () => {
      renderPageAndLayer();
      act(() => useLangyContextTargetStore.getState().setSpotlight(chip.id));
      expect(screen.getByTestId("langy-target-spotlight")).toBeInTheDocument();

      act(() => useLangyStore.setState({ isOpen: false }));

      expect(screen.queryByTestId("langy-target-spotlight")).toBeNull();
    });
  });
});

describe("given a page with something Langy can be given", () => {
  const target = {
    id: "workflow:wf_1",
    kind: "workflow" as const,
    label: "workflow: checkout",
    ref: "wf_1",
  };

  describe("when the user has never handed Langy anything", () => {
    it("teaches the gesture once, naming both routes in", () => {
      useLangyStore.setState({ contextHintDismissed: false });
      useLangyContextTargetStore.getState().register(target);
      renderComposer();

      const hint = screen.getByTestId("langy-context-gesture-hint");
      expect(hint).toHaveTextContent("#");
      expect(hint.textContent).toMatch(/drag/i);
    });

    it("says nothing on a page with nothing to point at", () => {
      useLangyStore.setState({ contextHintDismissed: false });
      renderComposer();

      expect(screen.queryByTestId("langy-context-gesture-hint")).toBeNull();
    });
  });

  describe("when the user dismisses the hint", () => {
    it("does not show it again", async () => {
      const user = userEvent.setup();
      useLangyStore.setState({ contextHintDismissed: false });
      useLangyContextTargetStore.getState().register(target);
      const { unmount } = renderComposer();

      await user.click(screen.getByRole("button", { name: /dismiss hint/i }));
      expect(screen.queryByTestId("langy-context-gesture-hint")).toBeNull();

      unmount();
      renderComposer();
      expect(screen.queryByTestId("langy-context-gesture-hint")).toBeNull();
    });
  });
});
