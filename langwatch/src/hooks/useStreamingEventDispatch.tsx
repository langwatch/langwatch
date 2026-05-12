import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import type { CompactStreamingEvent } from "~/utils/streaming-event-codec";

type StreamingEventHandler = (payload: CompactStreamingEvent) => void;

interface StreamingEventDispatch {
  subscribe: (handler: StreamingEventHandler) => () => void;
  dispatch: StreamingEventHandler;
}

const StreamingEventContext = createContext<StreamingEventDispatch | null>(null);

/**
 * Provides a pub/sub bus for streaming events so a single SSE subscription
 * can distribute events to many SimulationChatViewer cards on the grid page.
 */
export function StreamingEventProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const handlersRef = useRef(new Set<StreamingEventHandler>());

  const subscribe = useCallback((handler: StreamingEventHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const dispatch = useCallback((payload: CompactStreamingEvent) => {
    for (const handler of handlersRef.current) {
      handler(payload);
    }
  }, []);

  return (
    <StreamingEventContext.Provider value={{ subscribe, dispatch }}>
      {children}
    </StreamingEventContext.Provider>
  );
}

/** Returns the dispatch function to push streaming events into the bus. */
export function useStreamingEventDispatch(): StreamingEventHandler {
  const ctx = useContext(StreamingEventContext);
  if (!ctx) {
    throw new Error("useStreamingEventDispatch must be inside StreamingEventProvider");
  }
  return ctx.dispatch;
}

/**
 * Subscribes a handler to the streaming event bus.
 * The handler is typically `handleStreamingEvent` from `useSimulationStreamingState`.
 * Safe to call outside a provider (no-op).
 */
export function useStreamingEventSubscription(handler: StreamingEventHandler) {
  const ctx = useContext(StreamingEventContext);
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(handler);
  }, [ctx, handler]);
}
