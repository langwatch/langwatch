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
});
