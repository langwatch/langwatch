// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLangyOrbProximity } from "../useLangyOrbProximity";

/**
 * The proximity effect binds to the orb NODE, and the orb is not always there.
 *
 * The launcher stays mounted for the whole session and merely renders null
 * while the panel is open, so the node the hook bound to disappears and comes
 * back as a DIFFERENT element. The effect keys on `[enabled]` alone, which is
 * why `enabled` has to fall while the panel is open: without that the window
 * listeners stay bound to the old node, the rAF keeps writing styles into a
 * detached element (retaining it), and the glow is dead for the rest of the
 * session because nothing ever rebinds.
 *
 * So the two properties pinned here are exactly the ones the panel relies on:
 * disabling really lets go, and re-enabling binds to whatever node the ref
 * holds NOW.
 */

/** A stand-in orb with a real box, so the proximity maths has something to bite on. */
function makeOrb(): HTMLButtonElement {
  const orb = document.createElement("button");
  orb.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 100,
      right: 146,
      bottom: 146,
      width: 46,
      height: 46,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(orb);
  return orb;
}

/** Move the pointer next to the orb and let the animation frame it schedules run. */
function movePointerNearTheOrb() {
  act(() => {
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 120, clientY: 120 }),
    );
    vi.advanceTimersByTime(32);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // Unmount, don't just wipe the DOM: clearing `body` orphans the React root,
  // leaving this test's effect alive with its window listeners bound and its
  // rAF loop still writing into a detached orb for the rest of the file.
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useLangyOrbProximity", () => {
  function setup() {
    const view = renderHook(
      ({ enabled }: { enabled: boolean }) => useLangyOrbProximity({ enabled }),
      { initialProps: { enabled: false } },
    );
    // The orb mounts and React assigns the ref before the effect that enables
    // it runs — the same order a closing panel produces.
    const orb = makeOrb();
    const glow = document.createElement("span");
    orb.appendChild(glow);
    view.result.current.orbRef.current = orb;
    view.result.current.glowRef.current = glow;
    view.rerender({ enabled: true });
    return { ...view, orb, glow };
  }

  describe("given the orb is enabled with a node in the ref", () => {
    it("leans the orb toward the cursor", () => {
      const { orb } = setup();

      movePointerNearTheOrb();

      expect(orb.style.transform).not.toBe("");
    });
  });

  describe("when it is disabled again", () => {
    it("lets go of the node it was driving", () => {
      const { orb, glow, rerender } = setup();
      movePointerNearTheOrb();
      expect(orb.style.transform).not.toBe("");

      rerender({ enabled: false });

      // Cleanup returns the orb to the stylesheet's own resting state rather
      // than leaving whatever transform the last frame happened to write.
      expect(orb.style.transform).toBe("");
      expect(glow.style.opacity).toBe("0");
    });

    it("stops listening, so a moving pointer no longer drives it", () => {
      const { orb, rerender } = setup();
      movePointerNearTheOrb();

      rerender({ enabled: false });
      movePointerNearTheOrb();

      // Still parked: the pointermove reached nobody. Leaving the listener
      // bound is what kept the rAF writing into a detached orb.
      expect(orb.style.transform).toBe("");
    });

    it("cancels the frame it had queued", () => {
      const cancel = vi.spyOn(window, "cancelAnimationFrame");
      const { rerender } = setup();
      // A pointermove with no frame flush leaves a rAF outstanding — the one an
      // unmounting orb used to keep alive.
      act(() => {
        window.dispatchEvent(
          new MouseEvent("pointermove", { clientX: 120, clientY: 120 }),
        );
      });

      rerender({ enabled: false });

      expect(cancel).toHaveBeenCalled();
      cancel.mockRestore();
    });
  });

  describe("when it is enabled again over a different node", () => {
    it("binds to the node the ref holds now, not the one it first saw", () => {
      const { result, rerender, orb: first } = setup();
      movePointerNearTheOrb();
      rerender({ enabled: false });

      // The panel closed: the launcher renders a NEW button and the ref moves.
      const second = makeOrb();
      result.current.orbRef.current = second;
      result.current.glowRef.current = null;
      rerender({ enabled: true });

      movePointerNearTheOrb();

      expect(second.style.transform).not.toBe("");
      expect(first.style.transform).toBe("");
    });
  });
});
