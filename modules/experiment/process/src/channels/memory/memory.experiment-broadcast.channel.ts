import { EventEmitter } from "node:events";

import type { ExperimentBroadcast } from "../experiment-broadcast.channel.ts";

/** A deployment with no live-update channel: one emitter per project, in this process. */
export class MemoryExperimentBroadcastChannel implements ExperimentBroadcast {
  readonly #emitters = new Map<string, EventEmitter>();

  private constructor() {}

  static create(): MemoryExperimentBroadcastChannel {
    return new MemoryExperimentBroadcastChannel();
  }

  getTenantEmitter(projectId: string): EventEmitter {
    const existing = this.#emitters.get(projectId);
    if (existing) return existing;
    const emitter = new EventEmitter();
    this.#emitters.set(projectId, emitter);
    return emitter;
  }

  cleanupTenantEmitter(projectId: string): void {
    this.#emitters.delete(projectId);
  }
}
