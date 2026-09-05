import { useEffect } from "react";
import { useLangyContextTargetStore } from "./langy-context-target.store";

/**
 * The gesture that puts the page into "point at something and give it to Langy" mode.
 * Mounted once, by `LangyContextTargetLayer`.
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
