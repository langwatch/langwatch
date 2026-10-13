import type { InstanceGone, InstanceNudge, ReplyNudge } from "@langwatch/agent-contract";

import { ConnectedAgentRelayChannel, type Unsubscribe } from "../connected-agent-relay.channel.ts";

type Listeners<Message> = Map<string, Set<(message: Message) => void>>;

/** The one topic instance-gone word travels on. */
const EVERY_POD = "";

/**
 * The relay's messages inside one process: the memory tier and every test's.
 * Two runtimes handed one instance hear each other, the way two pods do.
 */
export class MemoryConnectedAgentRelayChannel extends ConnectedAgentRelayChannel {
  readonly shared = false;
  readonly #instances: Listeners<InstanceNudge> = new Map();
  readonly #replies: Listeners<ReplyNudge> = new Map();
  readonly #gone: Listeners<InstanceGone> = new Map();

  private constructor() {
    super();
  }

  static create(): MemoryConnectedAgentRelayChannel {
    return new MemoryConnectedAgentRelayChannel();
  }

  async nudgeInstance({
    projectId,
    instanceId,
    nudge,
  }: {
    projectId: string;
    instanceId: string;
    nudge: InstanceNudge;
  }): Promise<number> {
    return publish(this.#instances, `${projectId}:${instanceId}`, nudge);
  }

  async listenToInstance({
    projectId,
    instanceId,
    onNudge,
  }: {
    projectId: string;
    instanceId: string;
    onNudge: (nudge: InstanceNudge) => void;
  }): Promise<Unsubscribe> {
    return listen(this.#instances, `${projectId}:${instanceId}`, onNudge);
  }

  async nudgeReply({ podId, nudge }: { podId: string; nudge: ReplyNudge }): Promise<void> {
    publish(this.#replies, podId, nudge);
  }

  async listenForReplies({
    podId,
    onReply,
  }: {
    podId: string;
    onReply: (nudge: ReplyNudge) => void;
  }): Promise<Unsubscribe> {
    return listen(this.#replies, podId, onReply);
  }

  async announceInstanceGone(gone: InstanceGone): Promise<void> {
    publish(this.#gone, EVERY_POD, gone);
  }

  async listenForInstanceGone(onGone: (gone: InstanceGone) => void): Promise<Unsubscribe> {
    return listen(this.#gone, EVERY_POD, onGone);
  }

  async close(): Promise<void> {
    this.#instances.clear();
    this.#replies.clear();
    this.#gone.clear();
  }
}

/**
 * Delivered on the next tick, the way a socket would, so a publisher never
 * re-enters its own listener; resolves to the listeners present now.
 */
function publish<Message>(listeners: Listeners<Message>, topic: string, message: Message): number {
  const count = listeners.get(topic)?.size ?? 0;
  setImmediate(() => {
    for (const listener of listeners.get(topic) ?? []) listener(message);
  });
  return count;
}

function listen<Message>(
  listeners: Listeners<Message>,
  topic: string,
  listener: (message: Message) => void,
): Unsubscribe {
  const set = listeners.get(topic) ?? new Set();
  set.add(listener);
  listeners.set(topic, set);
  return async () => {
    set.delete(listener);
    if (set.size === 0 && listeners.get(topic) === set) listeners.delete(topic);
  };
}
