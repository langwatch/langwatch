import type { AgentCallSignal } from "@langwatch/agent-contract";
import { instanceGoneSchema, replyNudgeSchema } from "@langwatch/agent-contract";
import type { SessionStateStore, Unsubscribe } from "@langwatch/redis-client/session-state";
import {
  INSTANCE_GONE_CHANNEL,
  replyChannel,
  resultKey,
} from "../rules/connected-agent-keys.rules.ts";
import { z } from "zod";

type Waiter = {
  resolve: (outcome: WaitOutcome) => void;
};

type WaitOutcome =
  | { kind: "result" }
  | { kind: "ack" }
  | { kind: "gone" }
  | { kind: "timeout" }
  | { kind: "aborted" };

type ReplyOptions = { podId: string; store: SessionStateStore; pollMs: number };

/** Owns reply subscriptions and outstanding waits for one process. */
export class ConnectedAgentReplyService {
  readonly #podId: string;
  readonly #store: SessionStateStore;
  readonly #resultPollMs: number;
  readonly #waiters = new Map<string, Waiter[]>();
  readonly #instanceOfCall = new Map<string, { projectId: string; instanceId: string }>();
  #subscriptions: Unsubscribe[] | null = null;
  #starting: Promise<void> | null = null;

  static create(options: ReplyOptions): ConnectedAgentReplyService {
    return new ConnectedAgentReplyService(options);
  }

  private constructor(options: ReplyOptions) {
    this.#podId = options.podId;
    this.#store = options.store;
    this.#resultPollMs = options.pollMs;
  }

  /** Subscribes this pod's reply channel and the instance-gone channel. */
  start(): Promise<void> {
    if (this.#subscriptions) return Promise.resolve();
    this.#starting ??= this.#subscribe().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #subscribe(): Promise<void> {
    const subscriptions: Unsubscribe[] = [];
    try {
      subscriptions.push(
        await this.#store.subscribe(replyChannel(this.#podId), (raw) => {
          const nudge = findParsedFrame(replyNudgeSchema, raw);
          if (!nudge) return;
          this.#wake(nudge.callId, { kind: nudge.kind });
        }),
      );
      subscriptions.push(
        await this.#store.subscribe(INSTANCE_GONE_CHANNEL, (raw) => {
          const gone = findParsedFrame(instanceGoneSchema, raw);
          if (!gone) return;
          for (const [callId, held] of this.#instanceOfCall) {
            if (held.instanceId === gone.instanceId && held.projectId === gone.projectId) {
              this.#wake(callId, { kind: "gone" });
            }
          }
        }),
      );
      this.#subscriptions = subscriptions;
    } catch (error) {
      await Promise.allSettled(subscriptions.map((unsubscribe) => unsubscribe()));
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.#starting?.catch(() => void 0);
    const subscriptions = this.#subscriptions ?? [];
    this.#subscriptions = null;
    for (const [callId] of this.#waiters) this.#wake(callId, { kind: "aborted" });
    await Promise.all(subscriptions.map((unsubscribe) => unsubscribe()));
  }

  track(callId: string, instance: { projectId: string; instanceId: string }): void {
    this.#instanceOfCall.set(callId, instance);
  }

  release(callId: string): void {
    this.#instanceOfCall.delete(callId);
    this.#waiters.delete(callId);
  }

  /** Waits for a result nudge, a gone signal, the deadline or an abort. */
  wait({
    projectId,
    callId,
    deadlineAt,
    signal,
    now,
  }: {
    projectId: string;
    callId: string;
    deadlineAt: number;
    signal?: AgentCallSignal;
    now: () => number;
  }): Promise<WaitOutcome> {
    return new Promise<WaitOutcome>((resolve) => {
      if (signal?.aborted) {
        resolve({ kind: "aborted" });
        return;
      }
      let settled = false;
      const timers: NodeJS.Timeout[] = [];
      const stopPolling = this.#pollForResult(projectId, callId, () => finish({ kind: "result" }));
      const finish = (outcome: WaitOutcome) => {
        if (settled) return;
        settled = true;
        stopPolling();
        for (const timer of timers) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(outcome);
      };
      const onAbort = () => finish({ kind: "aborted" });
      signal?.addEventListener("abort", onAbort, { once: true });

      const waiter: Waiter = {
        resolve: (outcome) => {
          // An ack keeps the wait going; it only changes what a later
          // disconnect means, which `runOnInstance` reads off the ack key.
          if (outcome.kind === "ack") return;
          finish(outcome);
        },
      };
      this.#waiters.set(callId, [...(this.#waiters.get(callId) ?? []), waiter]);

      const budget = Math.max(0, deadlineAt - now());
      timers.push(setTimeout(() => finish({ kind: "timeout" }), budget));
    });
  }

  /** Polling recovers results whose notification was lost during a Redis reconnect. */
  #pollForResult(projectId: string, callId: string, onResult: () => void): () => void {
    let stopped = false;
    const poll = async (): Promise<void> => {
      const result = await this.#store.tryGet(resultKey(projectId, callId)).catch(() => null);
      if (stopped) return;
      if (result) {
        onResult();
        return;
      }
      timer = setTimeout(() => void poll(), this.#resultPollMs);
    };
    let timer = setTimeout(() => void poll(), this.#resultPollMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }

  #wake(callId: string, outcome: WaitOutcome): void {
    for (const waiter of this.#waiters.get(callId) ?? []) waiter.resolve(outcome);
  }
}

function findParsedFrame<Schema extends z.ZodType>(
  schema: Schema,
  raw: string,
): z.output<Schema> | null {
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
