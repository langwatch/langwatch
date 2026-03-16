/**
 * In-memory EventEmitter registry for coordinating progress between
 * the streaming download endpoint and the SSE progress sideband.
 *
 * Each active export gets a unique ID. The download route creates an emitter
 * and emits progress events as batches complete. The SSE endpoint listens
 * on the same emitter to relay progress to the client.
 *
 * Emitters are cleaned up when the export completes or the SSE disconnects.
 *
 * Ownership info (userId, projectId) is stored alongside each emitter
 * so the SSE endpoint can verify the requesting user owns the export.
 */

import { EventEmitter } from "events";

interface ProgressEmitterEntry {
  emitter: EventEmitter;
  userId: string;
  projectId: string;
}

const emitters = new Map<string, ProgressEmitterEntry>();

/** Create and register a new progress emitter for the given export ID. */
export function createProgressEmitter({
  exportId,
  userId,
  projectId,
}: {
  exportId: string;
  userId: string;
  projectId: string;
}): EventEmitter {
  // Clean up any existing emitter for this exportId to prevent leaks
  const existing = emitters.get(exportId);
  if (existing) {
    existing.emitter.removeAllListeners();
    emitters.delete(exportId);
  }

  const emitter = new EventEmitter();
  emitters.set(exportId, { emitter, userId, projectId });
  return emitter;
}

/** Retrieve an existing progress emitter entry, or undefined if not found. */
export function getProgressEmitter(exportId: string): ProgressEmitterEntry | undefined {
  return emitters.get(exportId);
}

/** Remove and clean up a progress emitter. */
export function removeProgressEmitter(exportId: string): void {
  const entry = emitters.get(exportId);
  if (entry) {
    entry.emitter.removeAllListeners();
    emitters.delete(exportId);
  }
}
