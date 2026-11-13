import { FRAME_MARGIN, frameBox } from "../model/docs-session.ts";

/*
 * The session frame lives outside the content the docs swap in place, so a page change keeps it
 * and its key; a reload still unloads it (ADR-185, amendment of 2026-11-13). Moving an iframe in
 * the DOM reloads it, so it never moves: it is laid over the room each page leaves for it.
 */

/** The room the playground leaves for the frame; one anywhere else on the page never draws it. */
export const FRAME_ROOM_SELECTOR = "[data-docs-playground] [data-docs-session-frame]";

let host: HTMLElement | null = null;
let frame: HTMLIFrameElement | null = null;
let room: HTMLElement | null = null;
/* The frame's room before it says how tall it is, as docs.css first draws it. */
let height = 40;
let scheduled = 0;
let shown = false;
/* Tells the frame it is visible again, so a confirmation it holds restarts its press delay. */
let onShown: () => void = () => {};
/* Absent only where the browser has no ResizeObserver; scrolling and resizing still place it. */
const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);

/** Puts `element` in the persistent host and lays it over the current page's room. */
export function holdFrame({
  element,
  whenShown,
}: {
  element: HTMLIFrameElement;
  whenShown: () => void;
}) {
  onShown = whenShown;
  host = document.createElement("div");
  host.dataset.docsSessionHost = "";
  Object.assign(host.style, { position: "absolute", top: "0", left: "0", width: "0", height: "0" });
  Object.assign(element.style, { position: "absolute", margin: "0", zIndex: "1" });
  host.append(element);
  document.body.append(host);
  frame = element;
  resized?.observe(document.documentElement);
  window.addEventListener("resize", schedule);
  document.addEventListener("scroll", schedule, { capture: true, passive: true });
  document.addEventListener("docs:navigated", findRoom);
  findRoom();
}

/** The height the frame asked for; its room grows to hold it. */
export function setFrameHeight({ px }: { px: number }) {
  height = px;
  if (frame) frame.style.height = `${px}px`;
  schedule();
}

/** Finds the room the current page leaves for the frame, if any, and lays the frame over it. */
export function findRoom() {
  const next = document.querySelector<HTMLElement>(FRAME_ROOM_SELECTOR);
  if (next !== room) {
    if (room) resized?.unobserve(room);
    room = next;
    if (room) resized?.observe(room);
  }
  schedule();
}

function schedule() {
  if (scheduled) return;
  scheduled = requestAnimationFrame(() => {
    scheduled = 0;
    place();
  });
}

function place() {
  if (!frame || !host) return;
  if (room && !room.isConnected) findRoom();
  const ready = frame.dataset.docsFrameReady !== undefined;
  if (room) room.style.height = ready ? `${height + 2 * FRAME_MARGIN}px` : "0px";
  /* A room the page hides (the form closed) measures zero wide, which hides the frame too. */
  const box = frameBox({
    room: room?.getBoundingClientRect() ?? null,
    host: host.getBoundingClientRect(),
  });
  const visible = Boolean(box && ready);
  frame.style.visibility = visible ? "" : "hidden";
  if (visible && !shown) onShown();
  shown = visible;
  if (!box) return;
  frame.style.top = `${box.top}px`;
  frame.style.left = `${box.left}px`;
  frame.style.width = `${box.width}px`;
}
