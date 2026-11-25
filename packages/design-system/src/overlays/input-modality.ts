import { useEffect } from "react";

let lastInput: "pointer" | "keyboard" = "keyboard";
let listening = false;

const onPointer = () => {
  lastInput = "pointer";
};
const onKey = (event: KeyboardEvent) => {
  if (!event.metaKey && !event.ctrlKey && !event.altKey) lastInput = "keyboard";
};

/** Starts following the last input (pointer or keyboard) document-wide; idempotent. */
export function useInputModality() {
  useEffect(() => {
    if (listening) return;
    listening = true;
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
  }, []);
}

/** Whether the last input before now was a pointer: focus it moved carries no keyboard ring. */
export function lastInputWasPointer(): boolean {
  return lastInput === "pointer";
}
