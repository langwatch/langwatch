import { useSyncExternalStore } from "react";

/**
 * Module-level scroll-element store for the trace table. Consumers (the
 * virtualizer, new-traces indicator) subscribe via `useTraceTableScrollElement`
 * and re-render when the element attaches or detaches. `TraceTableLayout`
 * publishes via `setTraceTableScrollElement` from its callback ref.
 *
 * Why a state-driven store instead of a RefObject: react-virtual reads the
 * scroll element on its first render via `getScrollElement()`. If that returns
 * `null` (because the `<Box ref>` hasn't committed yet), the virtualizer
 * settles into an empty state and never recomputes — the table area stays
 * blank even though `count > 0`. Re-rendering consumers when the element
 * attaches is what makes the virtualizer pick it up.
 *
 * `useSyncExternalStore` is the textbook React 18 way to subscribe to an
 * external mutable source: it gives us tear-free reads, plays correctly with
 * suspense / concurrent rendering, and (crucially here) re-runs `getSnapshot`
 * on every render so a consumer that subscribed *before* the publisher's
 * callback ref fired still sees the up-to-date element on the next render
 * pass after the ref attaches. A `useState + useEffect` mirror would miss
 * the initial sync because the effect runs after the publisher's commit but
 * the consumer's render has already cached `null` in state. Avoiding React
 * Context keeps us aligned with traces-v2 STANDARDS §2.
 *
 * Rendering two trace tables on the same page would race on this store; we
 * don't do that today and would catch it in code review.
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
 * `TraceTableLayout`'s unmount cleanup to avoid a stale teardown
 * clobbering a *newer* layout's already-published element. React mounts
 * the new layout before running the old one's effect cleanup when the
 * outer pane swaps (e.g. tour activation flips ResultsPane →
 * EmptyResultsPane), and an unconditional null-set would race the new
 * mount and leave the virtualizer with no scroll element.
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
