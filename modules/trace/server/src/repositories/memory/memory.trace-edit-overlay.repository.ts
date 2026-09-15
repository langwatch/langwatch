import { generate } from "@langwatch/ksuid";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";
import {
  TraceEditOverlayRepository,
  type TraceEditOverlayRow,
} from "../trace-edit-overlay.repository.ts";

function rowKey(projectId: string, traceId: string): string {
  return `${projectId}:${traceId}`;
}

/**
 * In-memory twin of the Postgres-backed reviewer correction. The author
 * lines carry only the id a caller stamps in `upsert` - there is no User
 * table to join here, so `name`/`image` stay null rather than fabricated.
 */
export class MemoryTraceEditOverlayRepository extends TraceEditOverlayRepository {
  private readonly rows = new Map<string, TraceEditOverlayRow>();

  static create(): MemoryTraceEditOverlayRepository {
    return new MemoryTraceEditOverlayRepository();
  }

  async tryFindByProjectAndTrace({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<TraceEditOverlayRow | null> {
    return this.rows.get(rowKey(projectId, traceId)) ?? null;
  }

  async findAllByProjectAndTraces({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<TraceEditOverlayRow[]> {
    return traceIds
      .map((traceId) => this.rows.get(rowKey(projectId, traceId)))
      .filter((row): row is TraceEditOverlayRow => row !== undefined);
  }

  async upsert({
    projectId,
    traceId,
    patch,
    userId,
  }: {
    projectId: string;
    traceId: string;
    patch: TraceEditOverlayPatch;
    userId: string | null;
  }): Promise<TraceEditOverlayRow> {
    const key = rowKey(projectId, traceId);
    const existing = this.rows.get(key);
    const author = userId === null ? null : { id: userId, name: null, image: null };
    const now = new Date();
    const row: TraceEditOverlayRow = existing
      ? { ...existing, patch, updatedById: userId, updatedBy: author, updatedAt: now }
      : {
          id: generate("traceedit").toString(),
          projectId,
          traceId,
          patch,
          createdById: userId,
          updatedById: userId,
          createdAt: now,
          updatedAt: now,
          createdBy: author,
          updatedBy: author,
        };
    this.rows.set(key, row);
    return row;
  }

  async delete({ projectId, traceId }: { projectId: string; traceId: string }): Promise<void> {
    this.rows.delete(rowKey(projectId, traceId));
  }
}
