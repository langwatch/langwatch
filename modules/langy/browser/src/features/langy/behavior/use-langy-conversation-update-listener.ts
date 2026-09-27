import {
  type LangyConversationUpdateSignal,
  langyConversationUpdateSignalSchema,
} from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";
import { useSSESubscription } from "@langwatch/trace-browser-kit";
import { useEffect, useRef, useState } from "react";

import { api, type RouterOutputs } from "../../../behavior/langy-api.ts";

interface UseLangyConversationUpdateListenerOptions {
  projectId: string;
  enabled?: boolean;
  /**
   * Fires with the accumulated per-conversation signals after a quiet window.
   * Last-write-wins per conversation id: only the freshest operational spine
   * for each conversation is delivered.
   */
  onConversationUpdated?: (signals: LangyConversationUpdateSignal[]) => void | Promise<void>;
  debounceMs?: number;
  maxWaitMs?: number;
}

/**
 * Subscribes to the per-conversation freshness SSE (`langy.onConversationUpdate`) and
 * coalesces signals into a debounced callback.
 */
type Timer = ReturnType<typeof setTimeout>;

/**
 * Coalesces conversation update signals into one debounced delivery, keyed by conversation so
 * repeated updates collapse to the freshest; a max-wait bounds how long a busy stream can defer.
 */
class UpdateCoalescer {
  private debounceTimer: Timer | undefined;
  private maxWaitTimer: Timer | undefined;
  private pending = new Map<string, LangyConversationUpdateSignal>();

  constructor(private readonly deliver: (signals: LangyConversationUpdateSignal[]) => void) {}

  schedule({
    signal,
    debounceMs,
    maxWaitMs,
  }: {
    signal: LangyConversationUpdateSignal;
    debounceMs: number;
    maxWaitMs: number | undefined;
  }): void {
    this.pending.set(signal.conversationId, signal);
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(this.flush, debounceMs);
    if (maxWaitMs != null && !this.maxWaitTimer)
      this.maxWaitTimer = setTimeout(this.flush, maxWaitMs);
  }

  readonly flush = () => {
    this.dispose();
    const signals = [...this.pending.values()];
    this.pending = new Map();
    if (signals.length > 0) this.deliver(signals);
  };

  dispose(): void {
    clearTimeout(this.debounceTimer);
    clearTimeout(this.maxWaitTimer);
    this.debounceTimer = undefined;
    this.maxWaitTimer = undefined;
  }
}

/** The update signal a frame carries, when it carries one (a string frame is JSON). */
function frameSignals(event: unknown): LangyConversationUpdateSignal[] {
  if (!event) return [];
  try {
    const raw = typeof event === "string" ? JSON.parse(event) : event;
    const parsed = langyConversationUpdateSignalSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  } catch {
    // Non-JSON payload — ignore.
    return [];
  }
}

export function useLangyConversationUpdateListener({
  projectId,
  enabled = true,
  onConversationUpdated,
  debounceMs = 1500,
  maxWaitMs = 1500,
}: UseLangyConversationUpdateListenerOptions) {
  const onUpdatedRef = useRef(onConversationUpdated);
  onUpdatedRef.current = onConversationUpdated;
  const [coalescer] = useState(
    () => new UpdateCoalescer((signals) => void onUpdatedRef.current?.(signals)),
  );
  useEffect(() => () => coalescer.dispose(), [coalescer]);

  const [lastEventAt, setLastEventAt] = useState(0);

  const sse = useSSESubscription<
    RouterOutputs["langy"]["onConversationUpdate"],
    { projectId: string }
  >(
    api.langy.onConversationUpdate,
    { projectId },
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => {
        for (const signal of frameSignals(data.event)) {
          setLastEventAt(nowInstant().epochMilliseconds);
          coalescer.schedule({ signal, debounceMs, maxWaitMs });
        }
      },
    },
  );

  return { connectionState: sse.connectionState, lastEventAt };
}
