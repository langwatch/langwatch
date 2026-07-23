/**
 * @vitest-environment jsdom
 *
 * The claims this feature stands or falls on:
 *   1. ZERO cost while disarmed — with the panel closed AND with it open. No
 *      class, no visual state, no inline style, not draggable, and the page's
 *      own click behaviour untouched. The one thing a registered target does
 *      carry is its locating id, which paints nothing and listens to nothing:
 *      the panel → page spotlight has to be able to find the card a chip names
 *      without the user first arming anything.
 *   2. Offered — armed, or briefly revealed — a target lights up and a click
 *      means "give this to Langy" instead of whatever the surface's click meant.
 *   3. A `#trace` reveal makes the same offer the armed page does. It used to
 *      light rows up and answer to nothing, which made the palette's own promise
 *      ("anything that lights up can be added as context") untrue.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLangyContextTarget } from "../hooks/useLangyContextTarget";
import { useLangyContextTargetStore } from "../stores/langyContextTargetStore";
import { useLangyStore } from "../stores/langyStore";

/** A stand-in for any surface that opts in — a trace row, an evaluation card. */
function HostRow({ onOpen }: { onOpen: () => void }) {
  const langy = useLangyContextTarget({
    id: "trace:abc123",
    kind: "trace",
    label: "trace abc123",
    ref: "abc123",
  });

  return (
    <div data-testid="row" onClick={onOpen} {...langy.targetProps}>
      a trace
    </div>
  );
}

const targets = () => useLangyContextTargetStore.getState();
const langy = () => useLangyStore.getState();
const row = () => screen.getByTestId("row");

const traceTarget = {
  id: "trace:abc123",
  kind: "trace",
  label: "trace abc123",
  ref: "abc123",
} as const;

function reset() {
  targets().reset();
  langy().closePanel();
  langy().resetChosenChips();
}

describe("useLangyContextTarget", () => {
  beforeEach(reset);

  // Registration does NOT wait for the panel to open.
  //
  // It used to, and that made the arming gesture a lie: the page armed, told
  // the reader to "click anything highlighted", and registered nothing — so
  // there was nothing to highlight and nothing to click. Pointing at something
  // before opening Langy is the ordinary way to use this, and with the peek
  // shipped a closed panel is how Langy sits most of the time.
  describe("given the Langy panel is closed", () => {
    describe("when a target renders unarmed", () => {
      it("registers itself, so the page knows what it has", () => {
        render(<HostRow onOpen={() => undefined} />);

        expect(targets().targets["trace:abc123"]).toEqual(traceTarget);
      });

      it("stays invisible on the element — only the locating id", () => {
        render(<HostRow onOpen={() => undefined} />);

        expect(row().getAttribute("data-langy-target")).toBe("trace:abc123");
        expect(row().className).toBe("");
        expect(row().getAttribute("style")).toBeNull();
      });

      it("leaves the surface's own click behaviour intact", () => {
        let opened = 0;
        render(<HostRow onOpen={() => opened++} />);

        fireEvent.click(row());

        expect(opened).toBe(1);
      });
    });

    describe("when the page is armed with the panel still closed", () => {
      it("offers the target — the ring and the intercepted click", () => {
        render(<HostRow onOpen={() => undefined} />);
        act(() => targets().arm("hold"));

        expect(row().className).toContain("langy-target");
      });
    });
  });

  describe("given the Langy panel is open but the page is not armed", () => {
    beforeEach(() => {
      langy().openPanel();
    });

    describe("when a target mounts", () => {
      it("registers itself so Langy knows the thing is on the page", () => {
        render(<HostRow onOpen={() => undefined} />);

        expect(targets().targets["trace:abc123"]).toEqual(traceTarget);
      });

      it("still shows nothing — asking a question does not arm the page", () => {
        render(<HostRow onOpen={() => undefined} />);

        expect(row().className).toBe("");
        expect(row().getAttribute("data-langy-target-state")).toBeNull();
        expect(row().getAttribute("draggable")).toBeNull();
        expect(row().getAttribute("style")).toBeNull();
      });

      it("carries its locating id, so the panel can point back at it", () => {
        // Hovering a chip in the composer shines a light on the card it names,
        // and that is not the picking mode — it is reading the list you already
        // have. The layer finds the element by this attribute, so gating it on
        // arming meant the spotlight could never find anything.
        render(<HostRow onOpen={() => undefined} />);

        expect(row().getAttribute("data-langy-target")).toBe("trace:abc123");
      });
    });

    describe("when the target unmounts", () => {
      it("de-registers itself", () => {
        const { unmount } = render(<HostRow onOpen={() => undefined} />);
        expect(targets().targets["trace:abc123"]).toBeDefined();

        unmount();

        expect(targets().targets).toEqual({});
      });
    });

    describe("when the user clicks the target itself", () => {
      it("runs the surface's own click and does NOT hijack it into context", () => {
        // The whole page must keep working with Langy open. An earlier cut
        // swallowed this click to add the row to context, which made every row
        // on the page un-openable the moment the panel opened.
        let opened = 0;
        render(<HostRow onOpen={() => opened++} />);

        fireEvent.click(row());

        expect(opened).toBe(1);
        expect(targets().picked).toEqual([]);
      });
    });

    describe("when the target is already in Langy's context", () => {
      it("does not paint a persistent outline through the page", () => {
        render(<HostRow onOpen={() => undefined} />);

        act(() => {
          targets().setActiveChipIds(["trace:abc123"]);
        });

        expect(row().getAttribute("data-langy-target-state")).toBeNull();
      });
    });

    describe("when the composer asks to see traces (#trace → reveal)", () => {
      it("lights the target up without arming the rest of the page", () => {
        render(<HostRow onOpen={() => undefined} />);

        act(() => targets().requestReveal({ kind: "trace" }));

        expect(row().getAttribute("data-langy-target-state")).toBe("near");
      });

      it("lets the lit row be clicked straight into context", () => {
        // The palette's own words: "anything that lights up can be added as
        // context". Revealed rows used to light up and do nothing but open
        // their own drawer, which made that copy a lie for as long as it showed.
        let opened = 0;
        render(<HostRow onOpen={() => opened++} />);
        act(() => targets().requestReveal({ kind: "trace" }));

        fireEvent.click(row());

        expect(targets().picked.map((t) => t.id)).toEqual(["trace:abc123"]);
        expect(langy().chosenChipIds.has("trace:abc123")).toBe(true);
        expect(opened).toBe(0);
      });

      it("lets the lit row be dragged onto the panel", () => {
        render(<HostRow onOpen={() => undefined} />);

        act(() => targets().requestReveal({ kind: "trace" }));

        expect(row().getAttribute("draggable")).toBe("true");
      });

      it("hands the row straight back when the reveal fades", () => {
        let opened = 0;
        render(<HostRow onOpen={() => opened++} />);
        act(() => targets().requestReveal({ kind: "trace" }));

        act(() => targets().clearReveal());

        expect(row().getAttribute("data-langy-target-state")).toBeNull();
        expect(row().getAttribute("draggable")).toBeNull();
        fireEvent.click(row());
        expect(opened).toBe(1);
      });

      it("ignores a reveal of some other kind", () => {
        render(<HostRow onOpen={() => undefined} />);

        act(() => targets().requestReveal({ kind: "dataset" }));

        expect(row().getAttribute("data-langy-target-state")).toBeNull();
        expect(row().getAttribute("draggable")).toBeNull();
      });
    });
  });

  describe("given the page is armed", () => {
    beforeEach(() => {
      langy().openPanel();
      act(() => targets().arm("key"));
    });

    describe("when a target mounts", () => {
      it("marks the element up so the layer can find it without a ref", () => {
        // Deliberately not a React ref: the trace table's row ref already
        // belongs to the virtualizer, and a target must never have to fight the
        // component it's decorating for it.
        render(<HostRow onOpen={() => undefined} />);

        expect(row().getAttribute("data-langy-target")).toBe("trace:abc123");
      });

      it("lights up, because the point of the mode is showing what can be given", () => {
        render(<HostRow onOpen={() => undefined} />);

        expect(row().getAttribute("data-langy-target-state")).toBe("near");
      });

      it("desyncs its shimmer from its neighbours with a stable phase offset", () => {
        render(<HostRow onOpen={() => undefined} />);

        expect(row().style.getPropertyValue("--langy-target-delay")).toMatch(
          /^-\d+ms$/,
        );
      });

      it("can be dragged onto the panel", () => {
        render(<HostRow onOpen={() => undefined} />);

        expect(row().getAttribute("draggable")).toBe("true");
      });
    });

    describe("when the user clicks the target", () => {
      it("gives it to Langy instead of running the surface's own click", () => {
        let opened = 0;
        render(<HostRow onOpen={() => opened++} />);

        fireEvent.click(row());

        expect(targets().picked.map((t) => t.id)).toEqual(["trace:abc123"]);
        expect(langy().chosenChipIds.has("trace:abc123")).toBe(true);
        expect(opened).toBe(0);
      });
    });

    describe("when the page is disarmed again", () => {
      it("hands the element straight back", () => {
        let opened = 0;
        render(<HostRow onOpen={() => opened++} />);
        expect(row().getAttribute("draggable")).toBe("true");

        act(() => targets().disarm());

        expect(row().className).toBe("");
        expect(row().getAttribute("data-langy-target-state")).toBeNull();
        expect(row().getAttribute("draggable")).toBeNull();
        fireEvent.click(row());
        expect(opened).toBe(1);
      });
    });
  });

  describe("given a surface with nothing to offer", () => {
    describe("when it passes a null target", () => {
      it("stays inert even armed", () => {
        langy().openPanel();
        act(() => targets().arm("key"));

        function EmptyHost() {
          const target = useLangyContextTarget(null);
          return <div data-testid="empty" {...target.targetProps} />;
        }
        render(<EmptyHost />);

        expect(screen.getByTestId("empty").className).toBe("");
        expect(targets().targets).toEqual({});
      });
    });
  });
});

describe("the target's toggle", () => {
  beforeEach(() => {
    reset();
    langy().openPanel();
  });

  /** Surfaces the handle so we can drive `toggle` the way the layer's button does. */
  function ToggleHost() {
    const target = useLangyContextTarget(traceTarget);
    return (
      <button type="button" data-testid="affordance" onClick={target.toggle}>
        {target.isAdded ? "Absorbed" : "Absorb context"}
      </button>
    );
  }

  describe("given the target is not in context", () => {
    describe("when the affordance is clicked", () => {
      it("adds it as a chip", () => {
        render(<ToggleHost />);

        fireEvent.click(screen.getByTestId("affordance"));

        expect(targets().picked.map((t) => t.id)).toEqual(["trace:abc123"]);
      });

      it("chooses the chip, so a page-derived offer becomes real context", () => {
        render(<ToggleHost />);

        fireEvent.click(screen.getByTestId("affordance"));

        expect(langy().chosenChipIds.has("trace:abc123")).toBe(true);
      });
    });
  });

  describe("given the target's chip is already in the composer", () => {
    // Covers BOTH routes to "added": a chip the user picked, and one Langy
    // derived from the route / open drawer. Both land in activeChipIds.
    beforeEach(() => {
      targets().setActiveChipIds(["trace:abc123"]);
    });

    describe("when the affordance is clicked again", () => {
      it("takes it back out of context", () => {
        targets().pick(traceTarget);
        langy().chooseChip("trace:abc123");
        render(<ToggleHost />);

        fireEvent.click(screen.getByTestId("affordance"));

        expect(targets().picked).toEqual([]);
        // Dropped too — the chip showing might have been derived rather than
        // picked, and unpicking alone would leave it in the composer.
        expect(langy().chosenChipIds.has("trace:abc123")).toBe(false);
      });
    });
  });
});
