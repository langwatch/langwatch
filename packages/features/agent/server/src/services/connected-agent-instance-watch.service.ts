/**
 * The watches this pod holds on connected-agent instances: one subscription per instance,
 * refreshed by every poll and expired when the polls stop.
 */

import { type InstanceNudge, instanceNudgeSchema } from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";
import { instanceMetaKey, pendingKey, instanceChannel } from "../rules/connected-agent-keys.rules.ts";
import type { Unsubscribe } from "@langwatch/agent-contract";
import type { AgentSessionService, SessionInfo } from "./connected-agent-session.service.ts";

const logger = createLogger("langwatch:connected-agents:instance-watch");

export interface Watch {
  session: SessionInfo;
  unsubscribe: Unsubscribe;
  waiters: Set<(nudge: InstanceNudge) => void>;
  expiry: NodeJS.Timeout;
}

export class InstanceWatchService {
  static create(options: { core: AgentSessionService; watchTtlMs: number }): InstanceWatchService {
    return new InstanceWatchService(options.core, options.watchTtlMs);
  }

  private readonly watches = new Map<string, Watch>();

  private constructor(
    private readonly core: AgentSessionService,
    private readonly watchTtlMs: number,
  ) {}

  /** How many instances this pod watches. */
  get watchCount(): number {
    return this.watches.size;
  }

  tryWaitForNudge({
    watch,
    ms,
    signal,
  }: {
    watch: Watch;
    ms: number;
    signal?: AbortSignal;
  }): Promise<InstanceNudge | null> {
    return new Promise((resolve) => {
      const finish = (nudge: InstanceNudge | null) => {
        clearTimeout(timer);
        watch.waiters.delete(waiter);
        signal?.removeEventListener("abort", onAbort);
        resolve(nudge);
      };
      const waiter = (nudge: InstanceNudge) => finish(nudge);
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), ms);
      watch.waiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Subscribes this pod to the instance's channel, or extends the watch it holds. */
  async ensureWatch(session: SessionInfo): Promise<Watch> {
    const watchKey = watchKeyOf(session);
    const existing = this.watches.get(watchKey);
    if (existing) {
      existing.session = session;
      existing.expiry.refresh();

      return existing;
    }

    const watch: Watch = {
      session,
      unsubscribe: async () => undefined,
      waiters: new Set(),
      expiry: setTimeout(() => void this.expireWatch(watchKey), this.watchTtlMs),
    };
    watch.expiry.unref();
    this.watches.set(watchKey, watch);
    watch.unsubscribe = await this.core.runtime.store.subscribe(
      instanceChannel(session.projectId, session.instanceId),
      (raw) => {
        let nudge: InstanceNudge;
        try {
          nudge = instanceNudgeSchema.parse(JSON.parse(raw));
        } catch {
          return;
        }

        for (const waiter of [...watch.waiters]) {
          waiter(nudge);
        }
      },
    );

    return watch;
  }

  /**
   * No poll reached this pod inside the TTL. When no pod did, the instance
   * is gone and the calls it held fail now; otherwise only this pod's
   * watch is dropped.
   */
  private async expireWatch(watchKey: string): Promise<void> {
    const watch = this.watches.get(watchKey);
    if (!watch) {
      return;
    }

    this.watches.delete(watchKey);
    await watch.unsubscribe();
    const { projectId, instanceId } = watch.session;
    const live = await this.core.runtime.store.tryHgetall(instanceMetaKey(projectId, instanceId));
    if (live) {
      return;
    }

    const pending = await this.core.runtime.store.zrangebyscore(
      pendingKey(projectId, instanceId),
      0,
    );
    logger.info({ instanceId }, "instance stopped polling, retiring it");
    await this.core.retire(watch.session, pending);
  }

  /** Drops this pod's watch on one instance, waking every poll parked on it. */
  async drop(session: SessionInfo): Promise<void> {
    const watchKey = watchKeyOf(session);
    const watch = this.watches.get(watchKey);
    if (!watch) {
      return;
    }

    this.watches.delete(watchKey);
    await this.release(watch);
  }

  /** Drops every watch this pod holds: the process is going away. */
  async closeAll(): Promise<void> {
    for (const [watchKey, watch] of this.watches) {
      this.watches.delete(watchKey);
      await this.release(watch);
    }
  }

  private async release(watch: Watch): Promise<void> {
    clearTimeout(watch.expiry);
    for (const waiter of watch.waiters) {
      waiter({ cancel: "" });
    }

    await watch.unsubscribe();
  }
}

/** A watch is per instance of one project: the instance id is client-chosen. */
function watchKeyOf(session: SessionInfo): string {
  return `${session.projectId}:${session.instanceId}`;
}
