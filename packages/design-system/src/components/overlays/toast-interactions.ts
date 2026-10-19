import { type CreateToasterReturn } from "@chakra-ui/react";
import { animate, type Transition } from "motion/react";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";

import { useReducedMotion } from "../../use-reduced-motion.ts";

export function isToastControl(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, a, input, select, textarea, [contenteditable=true]"))
  );
}

export function useToastStack(store: CreateToasterReturn) {
  const region = useRef<HTMLDivElement>(null);
  const pointerFocus = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [idle, setIdle] = useState(false);
  const [revision, setRevision] = useState("");
  const wasPaused = useRef(false);
  const paused = hovered || focused || expanded || dragging || idle;

  useEffect(
    () =>
      store.subscribe(() => {
        // Notifications precede mutation; reconcile lifecycle changes after the batch.
        queueMicrotask(() =>
          setRevision(
            JSON.stringify(
              store.getVisibleToasts().map((toast) => [toast.id, toast.type, toast.duration]),
            ),
          ),
        );
      }),
    [store],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      reconcileStack(store, { expanded, paused, setExpanded });
      if (wasPaused.current && !paused) store.resume();
      wasPaused.current = paused;
    });
    return () => {
      active = false;
    };
  }, [store, expanded, paused, revision]);

  useEffect(() => {
    const release = () => {
      pointerFocus.current = false;
    };
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    document.addEventListener("keydown", release, true);
    return () => {
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      document.removeEventListener("keydown", release, true);
    };
  }, []);

  useEffect(() => {
    setFocused(region.current?.contains(document.activeElement) ?? false);
    if (store.getCount() !== 0) return;
    setHovered(false);
    setDragging(false);
  }, [store, revision]);

  useStackDismissal(region, { expanded, setExpanded, setIdle });

  useToastPeek(region, hovered && !expanded);

  return {
    region,
    pointerFocus,
    hovered,
    expanded,
    setHovered,
    setFocused,
    setExpanded,
    setDragging,
  };
}

type Gesture = {
  id: number;
  x: number;
  y: number;
  lastX: number;
  time: number;
  velocity: number;
  axis: "pending" | "horizontal" | "vertical";
};

type SwipeState = {
  gesture: Gesture | null;
  suppressClick: boolean;
  animation: ReturnType<typeof animate> | null;
};

type SwipeOptions = {
  dismiss: () => void;
  onDragging: (dragging: boolean) => void;
  reduced: boolean;
};

function animateSwipe(
  element: HTMLDivElement,
  x: number,
  { dismissing, reduced }: { dismissing: boolean; reduced: boolean },
) {
  let transition: Transition = {
    type: "spring",
    stiffness: 300,
    damping: 26,
  };
  if (dismissing) transition = { duration: 0.2, ease: "easeOut" };
  if (reduced) transition = { duration: 0 };
  return animate(
    element,
    {
      x: [x, dismissing ? (Math.sign(x) || 1) * window.innerWidth : 0],
      opacity: dismissing ? 0 : 1,
    },
    transition,
  );
}

function finishSwipe(
  state: SwipeState,
  options: SwipeOptions,
  event: PointerEvent<HTMLDivElement>,
) {
  const current = state.gesture;
  if (!current || current.id !== event.pointerId) return;
  state.gesture = null;
  options.onDragging(false);
  if (current.axis !== "horizontal") return;
  const x = event.clientX - current.x;
  const width = event.currentTarget.getBoundingClientRect().width;
  const recent = event.timeStamp - current.time < 100;
  const fast = Math.abs(current.velocity) > 0.65;
  const sameDirection = Math.sign(current.velocity) === Math.sign(x);
  const flick = recent && fast && sameDirection && Math.abs(x) > 24;
  const cancelled = event.type !== "pointerup";
  const dismissing = !cancelled && (Math.abs(x) > width * 0.35 || flick);
  state.animation = animateSwipe(event.currentTarget, x, { dismissing, reduced: options.reduced });
  if (!dismissing) {
    const element = event.currentTarget;
    void state.animation.then(() => {
      element.style.removeProperty("transform");
      element.style.removeProperty("opacity");
    });
    return;
  }
  if (options.reduced) options.dismiss();
  else void state.animation.then(options.dismiss);
}

function beginSwipe(state: SwipeState, event: PointerEvent<HTMLDivElement>) {
  state.suppressClick = false;
  if (event.button !== 0 || isToastControl(event.target)) return;
  const root = event.currentTarget;
  if (root.hasAttribute("data-overlap") && !root.hasAttribute("data-first")) return;
  event.preventDefault();
  state.animation?.stop();
  state.gesture = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    lastX: event.clientX,
    time: event.timeStamp,
    velocity: 0,
    axis: "pending",
  };
}

function moveSwipe(state: SwipeState, options: SwipeOptions, event: PointerEvent<HTMLDivElement>) {
  const current = state.gesture;
  if (!current || current.id !== event.pointerId) return;
  const x = event.clientX - current.x;
  const y = event.clientY - current.y;
  const distance = Math.max(Math.abs(x), Math.abs(y));
  if (current.axis === "pending" && distance > 6) {
    current.axis = Math.abs(x) > Math.abs(y) ? "horizontal" : "vertical";
    state.suppressClick = true;
    if (current.axis === "horizontal") {
      event.currentTarget.setPointerCapture(event.pointerId);
      options.onDragging(true);
    }
  }
  if (current.axis !== "horizontal") return;
  const elapsed = event.timeStamp - current.time;
  if (elapsed > 0) current.velocity = (event.clientX - current.lastX) / elapsed;
  current.lastX = event.clientX;
  current.time = event.timeStamp;
  event.currentTarget.style.transform = `translateX(${x}px)`;
  const width = event.currentTarget.getBoundingClientRect().width;
  event.currentTarget.style.opacity = String(1 - Math.min(Math.abs(x) / width, 1) * 0.4);
}

export function useToastSwipe(options: Omit<SwipeOptions, "reduced">) {
  const reduced = useReducedMotion();
  const state = useRef<SwipeState>({ gesture: null, suppressClick: false, animation: null });
  useEffect(() => {
    const current = state.current;
    return () => current.animation?.stop();
  }, []);
  const settings = { ...options, reduced };
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => beginSwipe(state.current, event),
    onPointerMove: (event: PointerEvent<HTMLDivElement>) =>
      moveSwipe(state.current, settings, event),
    onPointerUp: (event: PointerEvent<HTMLDivElement>) =>
      finishSwipe(state.current, settings, event),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) =>
      finishSwipe(state.current, settings, event),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) =>
      finishSwipe(state.current, settings, event),
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (!state.current.suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

function reconcileStack(
  store: CreateToasterReturn,
  {
    expanded,
    paused,
    setExpanded,
  }: {
    expanded: boolean;
    paused: boolean;
    setExpanded: (expanded: boolean) => void;
  },
) {
  if (store.getCount() <= 1) setExpanded(false);
  if (expanded) store.expand();
  else store.collapse();
  if (paused) store.pause();
}

function useStackDismissal(
  region: React.RefObject<HTMLDivElement | null>,
  {
    expanded,
    setExpanded,
    setIdle,
  }: {
    expanded: boolean;
    setExpanded: (expanded: boolean) => void;
    setIdle: (idle: boolean) => void;
  },
) {
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!region.current?.contains(event.target)) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !expanded) return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    };
    const visibility = () => setIdle(document.visibilityState === "hidden");
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [region, expanded, setExpanded, setIdle]);
}

function useToastPeek(region: React.RefObject<HTMLDivElement | null>, peeking: boolean) {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!region.current) return;
    const animation = animate(
      region.current,
      { "--toast-peek": peeking ? 14 : 0 },
      reduced ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 22 },
    );
    return () => animation.stop();
  }, [region, peeking, reduced]);
}
