import { useEffect } from "react";
import { useLangyContextTargetStore } from "../stores/langyContextTargetStore";

/**
 * The gesture that puts the page into "point at something and give it to Langy"
 * mode. Mounted once, by `LangyContextTargetLayer`.
 *
 * Two ways in, because they suit two different intents:
 *
 *   `#`     — a LATCH. Press it, the page lights up and stays lit while you
 *             read, scroll, and pick several things. Press it again (or Escape)
 *             to put it away. This is the deliberate "I'm assembling context"
 *             mode. `#` because it is already Langy's context sigil in the
 *             composer, so the same key means the same thing on both sides.
 *
 *   Shift   — MOMENTARY. Hold it, glance, let go. For "what could I even add
 *             here?" — a question you ask for a second and then stop asking.
 *
 * Shift is a modifier people press constantly, so arming on a bare keydown
 * would flash the whole page every time someone typed a capital letter. Two
 * guards stop that: the hold only arms after {@link HOLD_ARM_DELAY_MS}, and any
 * other key pressed in that window cancels it outright — a capital letter is
 * Shift and a letter within a few milliseconds, never Shift alone for a third
 * of a second.
 *
 * Nothing here fires while the user is typing. `#` is a character you type into
 * the composer and into every search box on the page; stealing it there would
 * make the app unusable.
 */

/** How long Shift must be held alone before it counts as a deliberate hold. */
const HOLD_ARM_DELAY_MS = 350;

export function useLangyContextArming(): void {
  useEffect(() => {
    const store = () => useLangyContextTargetStore.getState();
    let holdTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelHold = () => {
      if (holdTimer === null) return;
      clearTimeout(holdTimer);
      holdTimer = null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Shift") cancelHold();
      if (isTypingInto(event.target)) return;

      if (event.key === "#") {
        event.preventDefault();
        store().toggleArm();
        return;
      }
      if (event.key === "Escape") {
        // Only swallow it when it actually did something, so Escape keeps
        // closing whatever drawer or dialog the user meant it for.
        if (store().armSource === null) return;
        event.preventDefault();
        event.stopPropagation();
        store().disarm();
        return;
      }
      if (event.key === "Shift" && !event.repeat && holdTimer === null) {
        holdTimer = setTimeout(() => {
          holdTimer = null;
          store().arm("hold");
        }, HOLD_ARM_DELAY_MS);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      cancelHold();
      store().disarm("hold");
    };

    // A keyup that lands on another window never reaches us, so a tab switch
    // mid-hold would leave the page armed with nobody holding anything.
    const onWindowBlur = () => {
      cancelHold();
      store().disarm("hold");
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      cancelHold();
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      store().disarm();
    };
  }, []);
}

/** Text entry of any kind — a real input, or anything made editable. */
export function isTypingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
