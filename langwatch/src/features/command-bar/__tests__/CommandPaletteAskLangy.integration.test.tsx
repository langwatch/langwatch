/**
 * @vitest-environment jsdom
 *
 * How selecting the "Ask Langy" activation routes. A typed question is already
 * the message, so selecting the row (Enter or click) hands it straight to the
 * Langy panel — one gesture, no intermediate composer step. Only an empty bar
 * flips the field into Langy's own composer, because there is nothing to send
 * yet. Spec: specs/langy/langy-command-bar-activation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openDrawerMock = vi.fn();
const routerPushMock = vi.fn(async () => true);

vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => true,
}));
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: openDrawerMock }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "demo" },
    organizations: [],
  }),
}));
vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: false, NODE_ENV: "test" } }),
}));
vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ hasAccess: false }),
}));
// Reduced motion makes the handoff close synchronously, so most tests need no
// timers; the overlap choreography itself is pinned by langyHandoff.unit.test.
// The deactivation test opts back into full motion to get a scheduled close.
const reducedMotionMock = vi.fn(() => true);
vi.mock("~/hooks/useReducedMotion", () => ({
  useReducedMotion: () => reducedMotionMock(),
}));
vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user_1" } } }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: "/[project]",
    query: {},
    asPath: "/demo",
    push: routerPushMock,
  }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: vi.fn() }),
}));
vi.mock("../useCommandSearch", () => ({
  useCommandSearch: () => ({
    idResult: null,
    searchResults: [],
    isLoading: false,
  }),
}));
vi.mock("../effects/useEasterEggEffects", () => ({
  useEasterEggEffects: () => ({ triggerEffect: vi.fn() }),
}));

import { useLangyStore } from "~/features/langy/stores/langyStore";
import { SUGGESTIONS } from "~/features/langy/components/EmptyState";
import { CommandPalette } from "../CommandPalette";

const QUESTION = "what are my traces about?";

function renderPalette({ query }: { query: string }) {
  const onDone = vi.fn();
  const setQuery = vi.fn();
  const palette = ({ active }: { active: boolean }) => (
    <ChakraProvider value={defaultSystem}>
      <CommandPalette
        surface="dialog"
        active={active}
        query={query}
        setQuery={setQuery}
        onDone={onDone}
      />
    </ChakraProvider>
  );
  const view = render(palette({ active: true }));
  const deactivate = () => view.rerender(palette({ active: false }));
  return { ...view, onDone, setQuery, deactivate };
}

const paletteInput = () =>
  screen.getByPlaceholderText("Where would you like to go?");

const langyModeSurface = (container: HTMLElement) =>
  container.querySelector("[data-langy-command-mode='true']");

const originalAskLangy = useLangyStore.getState().askLangy;

const resetLangyStore = () =>
  useLangyStore.setState({
    isOpen: false,
    pendingPrompt: null,
    composerFocusRequested: false,
    // The double-Enter test swaps the action for a spy; give it back.
    askLangy: originalAskLangy,
  });

beforeEach(() => {
  vi.clearAllMocks();
  reducedMotionMock.mockReturnValue(true);
  window.localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  resetLangyStore();
});

afterEach(() => {
  cleanup();
  resetLangyStore();
});

describe("given a question is already typed in the bar", () => {
  describe("when the Ask Langy row is selected with Enter", () => {
    /** @scenario Selecting Ask Langy with a typed question hands it off in one step */
    it("hands the question to Langy with no intermediate composer", () => {
      const { container, onDone } = renderPalette({ query: QUESTION });

      // Nothing else matches this query, so the Ask Langy row is selected.
      screen.getByText(`Ask Langy: "${QUESTION}"`);
      fireEvent.keyDown(paletteInput(), { key: "Enter" });

      const state = useLangyStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.pendingPrompt).toBe(QUESTION);
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(langyModeSurface(container)).toBeNull();
    });

    /** @scenario The composer is ready to keep typing after a handoff */
    it("asks the panel's composer to take focus with the handoff", () => {
      renderPalette({ query: QUESTION });

      fireEvent.keyDown(paletteInput(), { key: "Enter" });

      expect(useLangyStore.getState().composerFocusRequested).toBe(true);
    });

    it("hands off exactly once when Enter fires twice", () => {
      const askLangySpy = vi.fn(originalAskLangy);
      useLangyStore.setState({ askLangy: askLangySpy });
      const { onDone } = renderPalette({ query: QUESTION });

      fireEvent.keyDown(paletteInput(), { key: "Enter" });
      fireEvent.keyDown(paletteInput(), { key: "Enter" });

      expect(askLangySpy).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the Ask Langy row is clicked", () => {
    /** @scenario Selecting Ask Langy with a typed question hands it off in one step */
    it("hands the question off the same way", () => {
      const { container, onDone } = renderPalette({ query: QUESTION });

      fireEvent.click(screen.getByText(`Ask Langy: "${QUESTION}"`));

      const state = useLangyStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.pendingPrompt).toBe(QUESTION);
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(langyModeSurface(container)).toBeNull();
    });
  });

  describe("when the surface deactivates during the handoff overlap", () => {
    // The panel's composer takes focus with the handoff, which blurs the
    // home's inline field and deactivates the palette before the scheduled
    // close fires. The close must still run, or the field keeps the question
    // it already sent.
    it("still completes the close so the field can clear", () => {
      reducedMotionMock.mockReturnValue(false);
      const { deactivate, onDone } = renderPalette({ query: QUESTION });

      fireEvent.keyDown(paletteInput(), { key: "Enter" });
      expect(useLangyStore.getState().pendingPrompt).toBe(QUESTION);
      // Full motion: the close rides a timer to overlap the panel's entrance.
      expect(onDone).not.toHaveBeenCalled();

      deactivate();

      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given the bar is empty", () => {
  describe("when the Ask Langy row is selected with Enter", () => {
    /** @scenario Selecting Ask Langy on an empty bar turns it into AI mode */
    it("enters the composer mode and sends nothing", () => {
      const { container, onDone } = renderPalette({ query: "" });

      // Ask Langy leads an empty bar, so Enter selects it.
      fireEvent.keyDown(paletteInput(), { key: "Enter" });

      expect(langyModeSurface(container)).not.toBeNull();
      const state = useLangyStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.pendingPrompt).toBeNull();
      expect(onDone).not.toHaveBeenCalled();
    });
  });

  // The getting-started asks under the CTA (SUGGESTIONS) each carry a prompt.
  // Selecting one hands THAT prompt straight to Langy — the same handoff as a
  // typed question, not the empty-bar "enter composer mode" path.
  describe("when a getting-started suggestion is selected", () => {
    /** @scenario Selecting a getting-started suggestion hands its prompt to Langy */
    it("hands the suggestion's prompt to Langy on click", () => {
      const { onDone } = renderPalette({ query: "" });

      fireEvent.click(screen.getByText("Set up an evaluator"));

      const state = useLangyStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.pendingPrompt).toBe(
        "Suggest an evaluator for my agent and set it up.",
      );
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("hands the suggestion's prompt to Langy on Enter after arrowing to it", () => {
      renderPalette({ query: "" });

      // CTA leads at index 0; the three suggestions follow it.
      fireEvent.keyDown(paletteInput(), { key: "ArrowDown" });
      fireEvent.keyDown(paletteInput(), { key: "Enter" });

      expect(useLangyStore.getState().pendingPrompt).toBe(
        SUGGESTIONS[0]!.prompt,
      );
    });

    // The inline home renders its results only WHILE the field holds focus, so
    // a click on a suggestion first blurs the field. If the blur closed the
    // results synchronously, the row would unmount before its click landed and
    // clicking a suggestion on the home would do nothing. The field DEFERS the
    // close (mirrored by this harness — the same shape as LangyHomeHero) exactly
    // so the click survives. This pins that guard.
    it("fires on click in the inline surface even though the click blurs the field", () => {
      vi.useFakeTimers();
      function InlineHarness() {
        const [focused, setFocused] = useState(false);
        const fieldRef = useRef<HTMLDivElement>(null);
        return (
          <ChakraProvider value={defaultSystem}>
            <div ref={fieldRef}>
              <CommandPalette
                surface="inline"
                active={focused}
                query=""
                setQuery={vi.fn()}
                onDone={vi.fn()}
                onFocus={() => setFocused(true)}
                onBlur={() =>
                  window.setTimeout(() => {
                    if (!fieldRef.current?.contains(document.activeElement))
                      setFocused(false);
                  }, 0)
                }
              />
            </div>
          </ChakraProvider>
        );
      }
      render(<InlineHarness />);

      const input = screen.getByPlaceholderText("Where would you like to go?");
      fireEvent.focus(input); // results (with the suggestions) appear
      const row = screen.getByText("Compare two runs");
      fireEvent.blur(input); // the blur the click causes — close is deferred
      fireEvent.click(row); // must still land: the row is not yet gone

      const state = useLangyStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.pendingPrompt).toBe(SUGGESTIONS[2]!.prompt);

      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    });
  });
});
