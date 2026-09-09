import { useSyncExternalStore } from "react";

/**
 * Module-level scroll-element store for the trace table. Consumers (the virtualizer,
 * new-traces indicator) subscribe via `useTraceTableScrollElement` and re-render when
 * the element attaches or detaches.
 */

type Subscriber = () => void;
let currentEl: HTMLElement | null = null;
const subscribers = new Set<Subscriber>();

export function setTraceTableScrollElement(el: HTMLElement | null): void {
  if (currentEl === el) return;
  currentEl = el;
  subscribers.forEach((fn) => fn());
}

/**
 * Clear the store iff `el` is currently the published element. Used by
 * `TraceTableLayout`'s unmount cleanup to avoid a stale teardown clobbering a *newer*
 * layout's already-published element.
 */
export function releaseTraceTableScrollElement(el: HTMLElement): void {
  if (currentEl === el) {
    currentEl = null;
    subscribers.forEach((fn) => fn());
  }
}

function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

function getSnapshot(): HTMLElement | null {
  return currentEl;
}

function getServerSnapshot(): HTMLElement | null {
  return null;
}

export function useTraceTableScrollElement(): HTMLElement | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
