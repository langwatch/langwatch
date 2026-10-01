import type { EventEmitter } from "node:events";

/**
 * The project-scoped signal fan-out an editor tab follows. Declared as the two
 * methods the transports call: the emitter itself is the host's, shared with
 * every other subscription surface.
 */
export type ExperimentBroadcast = Readonly<{
  getTenantEmitter(projectId: string): EventEmitter;
  cleanupTenantEmitter(projectId: string): void;
}>;
