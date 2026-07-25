import { useEffect } from "react";
import { useLangyContextTargetStore } from "../stores/langyContextTargetStore";

/**
 * The gesture that puts the page into "point at something and give it to Langy"
 * mode. Mounted once, by `LangyContextTargetLayer`.
 *
 *   `#`     — a LATCH. Press it, the page lights up and stays lit while you
 *             read, scroll, and pick several things. Press it again (or Escape)
 *             to put it away. This is the deliberate "I'm assembling context"
 *             mode. `#` because it is already Langy's context sigil in the
 *             composer, so the same key means the same thing on both sides.
 *
 * The latch never fires while the user is typing: `#` is a character you
 * type into the composer and into every search box on the page, and stealing
 * it there would make the app unusable.
 */
export function useLangyContextArming(): void {
  useEffect(() => {
    const store = () => useLangyContextTargetStore.getState();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "#") {
        // The latch yields to typing — `#` is a real character in the
        // composer and every search box.
        if (isTypingInto(event.target)) return;
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
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
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
