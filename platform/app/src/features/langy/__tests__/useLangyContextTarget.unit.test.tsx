/**
 * @vitest-environment jsdom
 *
 * The claims this feature stands or falls on:
 *   1. ZERO cost when Langy is closed — no class, no data attribute, no inline
 *      style, and the page's own behaviour untouched.
 *   2. Langy NEVER steals the click. A trace row still opens its drawer with the
 *      panel open.
 *   3. Registered targets remain visually inert unless the user explicitly
 *      requests a reveal from the context palette.
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

const traceTarget = {
  id: "trace:abc123",
  kind: "trace",
  label: "trace abc123",
  ref: "abc123",
} as const;

describe("useLangyContextTarget", () => {
  beforeEach(() => {
    targets().reset();
    langy().closePanel();
    langy().resetDismissedChips();
  });

  describe("given the Langy panel is closed", () => {
    describe("when a target renders", () => {
      it("puts nothing on the element — no class, no data attribute, no style", () => {
        render(<HostRow onOpen={() => undefined} />);

        const row = screen.getByTestId("row");
        expect(row.className).toBe("");
        expect(row.getAttribute("data-langy-target")).toBeNull();
        expect(row.getAttribute("style")).toBeNull();
      });

      it("registers nothing, so the store stays empty", () => {
        render(<HostRow onOpen={() => undefined} />);

        expect(targets().targets).toEqual({});
      });

      it("leaves the surface's own click behaviour intact", () => {
        let opened = 0;
        render(<HostRow onOpen={() => opened++} />);

        fireEvent.click(screen.getByTestId("row"));

        expect(opened).toBe(1);
      });
    });
  });

  describe("given the Langy panel is open", () => {
    beforeEach(() => {
      langy().openPanel();
    });

    describe("when a target mounts", () => {
      it("registers itself so Langy knows the thing is on the page", () => {
        render(<HostRow onOpen={() => undefined} />);

        expect(targets().targets["trace:abc123"]).toEqual(traceTarget);
      });

      it("marks the element up so the layer can find it without a ref", () => {
        // Deliberately not a React ref: the trace table's row ref already
        // belongs to the virtualizer, and a target must never have to fight the
        // component it's decorating for it.
        render(<HostRow onOpen={() => undefined} />);

        expect(
          screen.getByTestId("row").getAttribute("data-langy-target"),
        ).toBe("trace:abc123");
      });

      it("stays invisible until the pointer comes near it", () => {
        render(<HostRow onOpen={() => undefined} />);

        expect(
          screen.getByTestId("row").getAttribute("data-langy-target-state"),
        ).toBeNull();
      });

      it("desyncs its shimmer from its neighbours with a stable phase offset", () => {
        render(<HostRow onOpen={() => undefined} />);

        expect(
          screen
            .getByTestId("row")
            .style.getPropertyValue("--langy-target-delay"),
        ).toMatch(/^-\d+ms$/);
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

        fireEvent.click(screen.getByTestId("row"));

        expect(opened).toBe(1);
        expect(targets().picked).toEqual([]);
      });
    });

    describe("when the composer asks to see traces (#trace → reveal)", () => {
      it("lights the target up like the pointer had come near", () => {
        render(<HostRow onOpen={() => undefined} />);

        act(() => targets().requestReveal({ kind: "trace" }));

        expect(
          screen.getByTestId("row").getAttribute("data-langy-target-state"),
        ).toBe("near");
      });
    });

    describe("when the target is already in Langy's context", () => {
      it("does not paint a persistent outline through the page", () => {
        render(<HostRow onOpen={() => undefined} />);

        act(() => {
          targets().setActiveChipIds(["trace:abc123"]);
        });

        expect(
          screen.getByTestId("row").getAttribute("data-langy-target-state"),
        ).toBeNull();
      });
    });
  });

  describe("given a surface with nothing to offer", () => {
    describe("when it passes a null target", () => {
      it("stays inert even with the panel open", () => {
        langy().openPanel();

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
    targets().reset();
    langy().closePanel();
    langy().resetDismissedChips();
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

      it("lifts any earlier dismissal, so a chip you removed can be re-added", () => {
        langy().dismissChip("trace:abc123");
        render(<ToggleHost />);

        fireEvent.click(screen.getByTestId("affordance"));

        expect(langy().dismissedChipIds.has("trace:abc123")).toBe(false);
      });
    });
  });

  describe("given the target's chip is already in the composer", () => {
    // Covers BOTH routes to "added": a chip the user picked, and one Langy
    // auto-derived from the route / open drawer. Both land in activeChipIds.
    beforeEach(() => {
      targets().setActiveChipIds(["trace:abc123"]);
    });

    describe("when the affordance is clicked again", () => {
      it("takes it back out of context", () => {
        targets().pick(traceTarget);
        render(<ToggleHost />);

        fireEvent.click(screen.getByTestId("affordance"));

        expect(targets().picked).toEqual([]);
        // Dismissed too — the chip showing might have been auto-derived rather
        // than picked, and unpicking alone would leave it in the composer.
        expect(langy().dismissedChipIds.has("trace:abc123")).toBe(true);
      });
    });
  });
});
