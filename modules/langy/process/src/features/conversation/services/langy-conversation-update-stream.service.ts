import {
  isLangyConversationUpdateVisibleToUser,
  langyConversationUpdateFrameSchema,
} from "@langwatch/langy-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { z } from "zod";

type Frame = z.infer<typeof langyConversationUpdateFrameSchema>;

export class LangyConversationUpdateStreamService {
  static create(): LangyConversationUpdateStreamService {
    return new LangyConversationUpdateStreamService();
  }

  private constructor() {}

  /** The tenant's freshness frames this user may see, until the signal aborts. */
  async *streamVisibleFrames(input: {
    emitter: ReturnType<PresenceApi["getTenantEmitter"]>;
    userId: string;
    signal: AbortSignal | undefined;
  }): AsyncGenerator<Frame> {
    for await (const payload of listen({
      emitter: input.emitter,
      event: "langy_conversation_updated",
      signal: input.signal,
    })) {
      const frame = langyConversationUpdateFrameSchema.safeParse(payload);
      if (
        !frame.success ||
        !isLangyConversationUpdateVisibleToUser({
          eventPayload: frame.data.event,
          userId: input.userId,
        })
      ) {
        continue;
      }
      yield frame.data;
    }
  }
}

/** Each emission's first argument, until the signal aborts; the listener is always removed. */
async function* listen(input: {
  emitter: ReturnType<PresenceApi["getTenantEmitter"]>;
  event: string;
  signal: AbortSignal | undefined;
}): AsyncGenerator<unknown> {
  const queued: unknown[] = [];
  let wake: (() => void) | null = null;
  const onEvent = (...args: unknown[]) => {
    queued.push(args[0]);
    wake?.();
  };
  const onAbort = () => wake?.();
  input.emitter.on(input.event, onEvent);
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (!input.signal?.aborted) {
      const next = queued.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  } finally {
    input.emitter.off(input.event, onEvent);
    input.signal?.removeEventListener("abort", onAbort);
  }
}
