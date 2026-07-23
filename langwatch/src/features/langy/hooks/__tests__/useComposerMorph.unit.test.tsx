// @vitest-environment jsdom
/**
 * The home page's send, as the hook that drives it.
 *
 * Two journeys are pinned here. The first is the one that does not happen: a
 * reader who has asked for less motion gets the panel open with the question
 * already in it and a spoken confirmation, and nothing travels. The second is
 * the one that does: the copy is aimed at wherever the panel's composer is
 * actually standing — measured through the closed panel — and the caret is
 * handed to that composer once it lands.
 *
 * `getBoundingClientRect` is stubbed per element because jsdom has no layout;
 * everything else (the store, the geometry, the timers) is the real thing.
 *
 * Spec: specs/home/langy-home-morph.feature
 */
import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_ANCHOR_ATTR } from "../../components/Composer";
import { PANEL_ROOT_ATTR } from "../../logic/composerMorphGeometry";
import { useLangyStore } from "../../stores/langyStore";
import { useComposerMorph } from "../useComposerMorph";

const HERO = { top: 120, left: 40, width: 720, height: 46 };
/** Where the floating card puts its composer: the bottom-right corner. */
const FLOATING_CORNER = { top: 620, left: 1040, width: 364, height: 40 };
/** How far the closed floating card sits off the right edge. */
const CLOSED_OFFSET = 392;

const stubRect = (element: HTMLElement, rect: typeof HERO) => {
  element.getBoundingClientRect = () => rect as DOMRect;
};

/** The hero composer's card, standing on the home page. */
function mountHeroCard() {
  const card = document.createElement("div");
  stubRect(card, HERO);
  document.body.appendChild(card);
  return card;
}

/**
 * The panel's composer, inside a floating card that is still wearing its
 * closed transform — the pose the reader never sees it resting in.
 */
function mountFloatingPanelComposer() {
  const panel = document.createElement("div");
  panel.setAttribute(PANEL_ROOT_ATTR, "");
  panel.style.transform = `translateX(${CLOSED_OFFSET}px)`;

  const composer = document.createElement("div");
  composer.setAttribute(COMPOSER_ANCHOR_ATTR, "panel");
  const textarea = document.createElement("textarea");
  composer.appendChild(textarea);
  panel.appendChild(composer);
  document.body.appendChild(panel);

  composer.getBoundingClientRect = () =>
    ({
      ...FLOATING_CORNER,
      left:
        FLOATING_CORNER.left +
        (panel.style.transform !== "none" ? CLOSED_OFFSET : 0),
    }) as DOMRect;

  return { textarea };
}

const setPrefersReducedMotion = (reduce: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: reduce,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

const renderMorph = (heroCardRef: ReturnType<typeof createRef<HTMLDivElement>>) =>
  renderHook(() => useComposerMorph({ heroCardRef }));

beforeEach(() => {
  vi.useFakeTimers();
  useLangyStore.getState().resetForProject("project-morph");
  useLangyStore.getState().closePanel();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useComposerMorph()", () => {
  describe("given the reader has asked the system for reduced motion", () => {
    beforeEach(() => setPrefersReducedMotion(true));

    describe("when a question is sent from the home page", () => {
      /** @scenario Nothing animates when I have asked for less motion */
      it("opens the panel on the question with nothing travelling across the screen", () => {
        const heroCardRef = createRef<HTMLDivElement>();
        heroCardRef.current = mountHeroCard();
        mountFloatingPanelComposer();

        const { result } = renderMorph(heroCardRef);
        act(() => result.current.ask("why are my traces failing"));
        // Only as far as the frame that WOULD have put the copy in the air:
        // waiting out the whole trip would pass either way.
        act(() => vi.advanceTimersByTime(32));

        expect(result.current.flight).toBeNull();
        expect(useLangyStore.getState().isOpen).toBe(true);
        expect(useLangyStore.getState().pendingPrompt).toBe(
          "why are my traces failing",
        );
      });

      it("says out loud what the animation would have said", () => {
        const heroCardRef = createRef<HTMLDivElement>();
        heroCardRef.current = mountHeroCard();
        mountFloatingPanelComposer();

        const { result } = renderMorph(heroCardRef);
        act(() => result.current.ask("why are my traces failing"));

        expect(result.current.announcement).toContain(
          "why are my traces failing",
        );
      });
    });
  });

  describe("given the reader uses the panel as a floating card", () => {
    beforeEach(() => {
      setPrefersReducedMotion(false);
      useLangyStore.getState().setPanelMode("floating");
    });

    describe("when a question is sent from the home page", () => {
      /** @scenario The composer travels to the floating panel */
      it("aims the copy from the block at the card's resting corner, not its closed pose", () => {
        const heroCardRef = createRef<HTMLDivElement>();
        heroCardRef.current = mountHeroCard();
        mountFloatingPanelComposer();

        const { result } = renderMorph(heroCardRef);
        act(() => result.current.ask("compare my last two runs"));
        act(() => vi.advanceTimersByTime(32));

        expect(result.current.flight?.origin).toEqual(HERO);
        expect(result.current.flight?.destination).toEqual(FLOATING_CORNER);
      });

      it("hands the caret to the panel's own composer once the copy lands", () => {
        const heroCardRef = createRef<HTMLDivElement>();
        heroCardRef.current = mountHeroCard();
        const { textarea } = mountFloatingPanelComposer();

        const { result } = renderMorph(heroCardRef);
        act(() => result.current.ask("compare my last two runs"));
        act(() => vi.advanceTimersByTime(600));

        expect(document.activeElement).toBe(textarea);
      });

      it("takes the copy down once the panel's composer has taken over", () => {
        const heroCardRef = createRef<HTMLDivElement>();
        heroCardRef.current = mountHeroCard();
        mountFloatingPanelComposer();

        const { result } = renderMorph(heroCardRef);
        act(() => result.current.ask("compare my last two runs"));
        act(() => vi.advanceTimersByTime(1_000));

        expect(result.current.flight).toBeNull();
      });
    });
  });
});
