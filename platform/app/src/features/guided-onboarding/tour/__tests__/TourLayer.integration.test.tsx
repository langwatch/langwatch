/**
 * @vitest-environment jsdom
 *
 * The tour engine under fake timers: steps advance on their own after their
 * reading time, Next and the counter move by hand, Skip ends, a missing
 * target is skipped, the spotlight follows a target that grew, and the end
 * hands the screen to the panel.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitMock = vi.fn();
vi.mock("react-contextual-analytics", () => ({
  AnalyticsBoundary: ({ children }: { children: React.ReactNode }) => children,
  useAnalytics: () => ({ emit: emitMock }),
}));

const pushMock = vi.fn();
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { useGuidedTourStore } from "../guidedTourStore";
import {
  TOUR_MISSING_TARGET_MS,
  TOUR_TARGET_POLL_MS,
  TourLayer,
} from "../TourLayer";
import { useTourRegistry } from "../tourRegistry";
import { readMs, TOUR_STEPS } from "../tourSteps";

/** jsdom lays nothing out, so each target answers with the rect we give it. */
const rects = new Map<string, DOMRect>();
function rect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x,
    y,
    left: x,
    top: y,
    width: w,
    height: h,
    right: x + w,
    bottom: y + h,
    toJSON: () => ({}),
  } as DOMRect;
}
function mountTarget(id: string, r: DOMRect) {
  const el = document.createElement("div");
  el.setAttribute("data-tour", id);
  document.body.appendChild(el);
  rects.set(id, r);
  return el;
}

const SETTLE = 350;
const TRAVEL = 850;

function renderLayer() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TourLayer />
    </ChakraProvider>,
  );
}

/** From a step's start to its caption being on screen. */
function landStep(onArrive: boolean) {
  act(() => vi.advanceTimersByTime(SETTLE));
  act(() => vi.advanceTimersByTime(TRAVEL));
  act(() => vi.advanceTimersByTime(onArrive ? 550 : 150));
}

describe("TourLayer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emitMock.mockReset();
    pushMock.mockReset();
    rects.clear();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return (
          rects.get(this.getAttribute("data-tour") ?? "") ?? rect(0, 0, 0, 0)
        );
      },
    );
    useTourRegistry.setState({ actions: {} });
    useGuidedTourStore.setState({
      running: false,
      path: null,
      stepIndex: 0,
      handoff: null,
      runId: 0,
      onEnd: null,
    });
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("given the llmops tour with every target on the page", () => {
    beforeEach(() => {
      mountTarget("sidebar", rect(60, 60, 220, 600));
      mountTarget("nav-group-build", rect(70, 200, 200, 28));
      mountTarget("product-switcher", rect(0, 0, 54, 700));
      mountTarget("project-switcher", rect(300, 12, 140, 32));
      mountTarget("langy-panel", rect(880, 60, 392, 640));
    });

    /** @scenario a step auto-advances after its reading time */
    it("shows the first caption and moves to step 2 after the reading time", () => {
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops"));
      landStep(false);
      expect(screen.getByTestId("tour-caption")).toHaveTextContent(
        TOUR_STEPS.llmops[0]!.text,
      );
      expect(screen.getByText("1 of 4")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(readMs(TOUR_STEPS.llmops[0]!.text)));
      expect(useGuidedTourStore.getState().stepIndex).toBe(1);
    });

    /** @scenario Next advances before the reading time elapses */
    it("advances on Next and drops the pending auto-advance", () => {
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops"));
      landStep(false);
      fireEvent.click(screen.getByText("Next"));
      expect(useGuidedTourStore.getState().stepIndex).toBe(1);
      landStep(true);
      /* the old step's timer would have pushed to step 3 by now if it survived */
      act(() => vi.advanceTimersByTime(readMs(TOUR_STEPS.llmops[0]!.text)));
      expect(useGuidedTourStore.getState().stepIndex).toBe(1);
      expect(emitMock).toHaveBeenCalledWith("clicked", "tour_next", {
        path: "llmops",
        step: 0,
      });
    });

    /** @scenario the step counter doubles as Back */
    it("goes back one step when the counter is clicked", () => {
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops"));
      act(() => useGuidedTourStore.getState().goToStep(1));
      landStep(true);
      fireEvent.click(screen.getByText("2 of 4"));
      expect(useGuidedTourStore.getState().stepIndex).toBe(0);
      expect(emitMock).toHaveBeenCalledWith("clicked", "tour_back", {
        path: "llmops",
        step: 1,
      });
    });

    /** @scenario the counter does nothing on the first step */
    it("ignores the counter on step 1", () => {
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops"));
      landStep(false);
      fireEvent.click(screen.getByText("1 of 4"));
      expect(useGuidedTourStore.getState().stepIndex).toBe(0);
      expect(useGuidedTourStore.getState().running).toBe(true);
    });

    /** @scenario Skip ends the tour as skipped */
    it("ends as skipped on Skip", () => {
      const onEnd = vi.fn();
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops", { onEnd }));
      act(() => useGuidedTourStore.getState().goToStep(1));
      landStep(true);
      fireEvent.click(screen.getByText("Skip"));
      expect(onEnd).toHaveBeenCalledWith("skipped");
      expect(emitMock).toHaveBeenCalledWith("clicked", "tour_skip", {
        path: "llmops",
        step: 1,
      });
    });

    /** @scenario Next on the last step ends the tour as completed */
    it("ends as completed on the last Next and reports the duration", () => {
      const onEnd = vi.fn();
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops", { onEnd }));
      act(() => useGuidedTourStore.getState().goToStep(3));
      landStep(false);
      fireEvent.click(screen.getByText("Next"));
      expect(onEnd).toHaveBeenCalledWith("completed");
      expect(emitMock).toHaveBeenCalledWith(
        "completed",
        "tour",
        expect.objectContaining({ path: "llmops" }),
      );
      const call = emitMock.mock.calls.find(
        (c) => c[1] === "tour" && c[0] === "completed",
      );
      expect(call?.[2].durationMs).toBeGreaterThan(0);
    });

    /** @scenario the first cursor placement is instant and later moves take 850 milliseconds */
    it("places the cursor with no transition first and animates later moves", () => {
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops"));
      act(() => vi.advanceTimersByTime(SETTLE));
      expect(screen.getByTestId("tour-cursor").style.transition).toBe("none");
      act(() => vi.advanceTimersByTime(TRAVEL + 150));
      fireEvent.click(screen.getByText("Next"));
      act(() => vi.advanceTimersByTime(SETTLE));
      expect(screen.getByTestId("tour-cursor").style.transition).toContain(
        "850ms",
      );
    });

    /** @scenario the spotlight is re-measured after the target grows */
    it("takes the group's grown size after the cursor lands", () => {
      const expandGroup = vi.fn(() => {
        rects.set("nav-group-build", rect(70, 200, 200, 180));
      });
      useTourRegistry.getState().register({ expandGroup });
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops"));
      act(() => useGuidedTourStore.getState().goToStep(1));
      act(() => vi.advanceTimersByTime(SETTLE));
      expect(screen.getByTestId("tour-spotlight").style.height).toBe("40px");
      act(() => vi.advanceTimersByTime(TRAVEL));
      expect(expandGroup).toHaveBeenCalledWith("library");
      act(() => vi.advanceTimersByTime(550));
      expect(screen.getByTestId("tour-spotlight").style.height).toBe("192px");
    });

    /** @scenario the spotlight follows a target that moves while the caption is up */
    it("moves the spotlight, cursor and caption onto the target's new place", () => {
      mountTarget("gw-new-key", rect(500, 80, 120, 32));
      mountTarget("vk-name", rect(900, 100, 460, 40));
      renderLayer();
      act(() => useGuidedTourStore.getState().start("gateway"));
      act(() => useGuidedTourStore.getState().goToStep(2));
      landStep(true);
      expect(screen.getByTestId("tour-spotlight").style.left).toBe("894px");
      /* the drawer finishes sliding in */
      rects.set("vk-name", rect(380, 100, 460, 40));
      act(() => vi.advanceTimersByTime(TOUR_TARGET_POLL_MS));
      expect(screen.getByTestId("tour-spotlight").style.left).toBe("374px");
      expect(screen.getByTestId("tour-cursor").style.transform).toBe(
        "translate(711.2px, 124.8px)",
      );
      expect(screen.getByTestId("tour-caption").style.left).toBe("644px");
    });

    /** @scenario the spotlight slides onto the panel when the tour ends */
    it("lights the panel at 0.5 for 4600ms, then fades over 1s", () => {
      const restoreGroups = vi.fn();
      useTourRegistry.getState().register({ restoreGroups });
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops"));
      act(() => useGuidedTourStore.getState().goToStep(3));
      landStep(false);
      fireEvent.click(screen.getByText("Next"));
      expect(restoreGroups).toHaveBeenCalled();
      expect(screen.queryByTestId("tour-cursor")).toBeNull();
      expect(screen.queryByTestId("tour-caption")).toBeNull();
      const spot = screen.getByTestId("tour-spotlight");
      expect(spot.dataset.handoff).toBe("lit");
      expect(spot.style.left).toBe("876px");
      expect(spot.style.width).toBe("400px");
      expect(spot.style.boxShadow).toContain("0.5");
      expect(spot.style.opacity).toBe("1");
      act(() => vi.advanceTimersByTime(4600));
      expect(screen.getByTestId("tour-spotlight").dataset.handoff).toBe(
        "fading",
      );
      expect(screen.getByTestId("tour-spotlight").style.opacity).toBe("0");
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.queryByTestId("tour-spotlight")).toBeNull();
    });

    /** @scenario the handoff spotlight sits below the panel and above the page */
    it("stacks above the drawer layer during the tour and below the panel at handoff", () => {
      const panel = document.querySelector<HTMLElement>(
        '[data-tour="langy-panel"]',
      )!;
      panel.style.zIndex = "1200";
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops"));
      act(() => vi.advanceTimersByTime(SETTLE));
      expect(
        Number(screen.getByTestId("tour-spotlight").style.zIndex),
      ).toBeGreaterThan(1500);
      act(() => vi.advanceTimersByTime(TRAVEL + 150));
      fireEvent.click(screen.getByText("Skip"));
      expect(screen.getByTestId("tour-spotlight").style.zIndex).toBe("1199");
    });

    /** @scenario the tour emits its events under the guided onboarding boundary */
    it("emits started and viewed events with the path, step and target", () => {
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops"));
      expect(emitMock).toHaveBeenCalledWith("started", "tour", {
        path: "llmops",
      });
      act(() => vi.advanceTimersByTime(SETTLE));
      expect(emitMock).toHaveBeenCalledWith("viewed", "tour_step", {
        path: "llmops",
        step: 0,
        target: "sidebar",
      });
    });
  });

  describe("given a target that is not on the page", () => {
    /** @scenario a missing target skips its step */
    it("moves on once the wait for the target runs out", () => {
      mountTarget("gw-new-key", rect(500, 80, 120, 32));
      renderLayer();
      act(() => useGuidedTourStore.getState().start("gateway"));
      act(() => vi.advanceTimersByTime(SETTLE + TOUR_MISSING_TARGET_MS - 200));
      expect(screen.queryByTestId("tour-cursor")).toBeNull();
      expect(useGuidedTourStore.getState().stepIndex).toBe(0);
      act(() => vi.advanceTimersByTime(300));
      expect(useGuidedTourStore.getState().stepIndex).toBe(1);
    });

    /** @scenario a target that is still loading is waited for */
    it("lands on a target that mounts while the step waits", () => {
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops"));
      act(() => vi.advanceTimersByTime(SETTLE + 2000));
      expect(screen.queryByTestId("tour-cursor")).toBeNull();
      mountTarget("sidebar", rect(60, 60, 220, 600));
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByTestId("tour-cursor")).toBeInTheDocument();
      expect(useGuidedTourStore.getState().stepIndex).toBe(0);
    });

    /** @scenario a target hidden by a flag or a permission is a missing target */
    it("skips the hidden virtual keys item and lands on the New key button", () => {
      const openVirtualKeyCreate = vi.fn();
      useTourRegistry.getState().register({ openVirtualKeyCreate });
      mountTarget("gw-new-key", rect(500, 80, 120, 32));
      renderLayer();
      act(() => useGuidedTourStore.getState().start("gateway"));
      act(() => vi.advanceTimersByTime(SETTLE + TOUR_MISSING_TARGET_MS + 100));
      landStep(true);
      expect(screen.getByTestId("tour-caption")).toHaveTextContent(
        "Let's create your first one right now.",
      );
      expect(openVirtualKeyCreate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText("Next"));
      expect(openVirtualKeyCreate).toHaveBeenCalled();
    });
  });

  describe("given a replay", () => {
    /** @scenario replay from the card runs the tour from step 1 */
    it("emits replayed-run start and ends without a callback", () => {
      mountTarget("sidebar", rect(60, 60, 220, 600));
      const onEnd = vi.fn();
      renderLayer();
      act(() => useGuidedTourStore.getState().start("llmops", { onEnd }));
      act(() => useGuidedTourStore.getState().end("completed"));
      act(() => useGuidedTourStore.getState().replay());
      landStep(false);
      expect(screen.getByText("1 of 4")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Skip"));
      expect(onEnd).toHaveBeenCalledTimes(1);
    });
  });
});
