import type { WorkspaceNudge } from "../../rules/langy-local-call-record.rules.ts";
import { LangyLocalWorkspaceChannel, type Unsubscribe } from "../langy-local-workspace.channel.ts";

/**
 * The workspace nudges inside one process: the memory tier and every test's.
 * Two runtimes handed one instance hear each other, the way two pods do.
 */
export class MemoryLangyLocalWorkspaceChannel extends LangyLocalWorkspaceChannel {
  readonly #listeners = new Map<string, Set<(nudge: WorkspaceNudge) => void>>();

  private constructor() {
    super();
  }

  static create(): MemoryLangyLocalWorkspaceChannel {
    return new MemoryLangyLocalWorkspaceChannel();
  }

  /** Delivered on the next tick, the way a socket would, so a publisher never hears itself. */
  async nudge({
    conversationId,
    nudge,
  }: {
    conversationId: string;
    nudge: WorkspaceNudge;
  }): Promise<void> {
    setImmediate(() => {
      for (const listener of Array.from(this.#listeners.get(conversationId) ?? [])) {
        listener(nudge);
      }
    });
  }

  async listen({
    conversationId,
    onNudge,
  }: {
    conversationId: string;
    onNudge: (nudge: WorkspaceNudge) => void;
  }): Promise<Unsubscribe> {
    const set = this.#listeners.get(conversationId) ?? new Set();
    set.add(onNudge);
    this.#listeners.set(conversationId, set);
    return async () => {
      set.delete(onNudge);
      if (set.size === 0 && this.#listeners.get(conversationId) === set) {
        this.#listeners.delete(conversationId);
      }
    };
  }

  async close(): Promise<void> {
    this.#listeners.clear();
  }
}
