/**
 * The resolver-pattern queue that lets `runOrchestrator` yield events as
 * they arrive from cells executing in parallel, rather than waiting for
 * every cell to finish before yielding anything.
 */

import type { EvaluationV3Event } from "@langwatch/experiment-contract";

export type EventStream = {
  /** Delivers an event to whoever is waiting, or queues it if no one is. */
  pushEvent: (event: EvaluationV3Event) => void;
  /** Marks that no more events are coming; a pending wait resolves to `null`. */
  signalComplete: () => void;
  /** The next queued event, or waits for one, or resolves `null` once complete and drained. */
  waitForEvent: () => Promise<EvaluationV3Event | null>;
};

export function createEventStream(): EventStream {
  type EventResolver = (event: EvaluationV3Event | null) => void;
  let eventResolve: EventResolver | null = null;
  const eventQueue: EvaluationV3Event[] = [];
  let allCellsComplete = false;

  const pushEvent = (event: EvaluationV3Event): void => {
    if (eventResolve) {
      const resolve = eventResolve;
      eventResolve = null;
      resolve(event);
    } else {
      eventQueue.push(event);
    }
  };

  const signalComplete = (): void => {
    allCellsComplete = true;
    if (eventResolve) {
      const resolve = eventResolve;
      eventResolve = null;
      resolve(null);
    }
  };

  const waitForEvent = (): Promise<EvaluationV3Event | null> => {
    if (eventQueue.length > 0) {
      return Promise.resolve(eventQueue.shift()!);
    }
    if (allCellsComplete) {
      return Promise.resolve(null);
    }
    return new Promise<EvaluationV3Event | null>((resolve) => {
      eventResolve = resolve;
    });
  };

  return { pushEvent, signalComplete, waitForEvent };
}
