import type { TraceRepositories } from "../trace.repositories.ts";
import { MemoryTraceEditOverlayRepository } from "./memory.trace-edit-overlay.repository.ts";

/** The "memory" tier: every trace repository the app is tested without a database. */
export class MemoryTraceRepositories {
  static readonly requires = [] as const;

  static create(): TraceRepositories {
    return {
      editOverlay: MemoryTraceEditOverlayRepository.create(),
    };
  }
}
