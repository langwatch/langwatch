import { ValidationError } from "@langwatch/handled-error";
import type { PrismaClient } from "@prisma/client";
import {
  type TraceEditOverlayAuthor,
  TraceEditOverlayRepository,
  type TraceEditOverlayRow,
} from "./traceEditOverlay.repository";
import {
  emptyTraceEditOverlayPatch,
  parseTraceEditOverlayPatch,
  patchHasAnyEdit,
  type TraceEditOverlayPatch,
  traceEditOverlayPatchSchema,
} from "./traceEditOverlay.schemas";

export interface TraceEditOverlayDto {
  traceId: string;
  patch: TraceEditOverlayPatch;
  createdBy: TraceEditOverlayAuthor | null;
  updatedBy: TraceEditOverlayAuthor | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Reviewer corrections for a trace: read, replace, merge and remove. There is
 * at most one correction per trace, so every write is an upsert and `updatedBy`
 * is the current editor.
 *
 * A stored patch this build cannot interpret reads as no correction. Absence is
 * the normal state for almost every trace, so degrading keeps a bad row from
 * turning into a failed trace read.
 */
export class TraceEditOverlayService {
  constructor(private readonly repository: TraceEditOverlayRepository) {}

  static create(prisma: PrismaClient): TraceEditOverlayService {
    return new TraceEditOverlayService(new TraceEditOverlayRepository(prisma));
  }

  async getByTraceId({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<TraceEditOverlayDto | null> {
    const row = await this.repository.findByProjectAndTrace({
      projectId,
      traceId,
    });
    if (!row) return null;
    const patch = parseTraceEditOverlayPatch(row.patch);
    return patch ? toDto({ row, patch }) : null;
  }

  /**
   * Corrections for a page of traces, keyed by trace id. Traces without a
   * correction, and rows whose patch no longer parses, are simply absent.
   */
  async getPatchesByTraceIds({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<Map<string, TraceEditOverlayPatch>> {
    const rows = await this.repository.findAllByProjectAndTraces({
      projectId,
      traceIds,
    });
    const patches = new Map<string, TraceEditOverlayPatch>();
    for (const row of rows) {
      const patch = parseTraceEditOverlayPatch(row.patch);
      if (patch) patches.set(row.traceId, patch);
    }
    return patches;
  }

  async upsert({
    projectId,
    traceId,
    patch,
    userId,
  }: {
    projectId: string;
    traceId: string;
    patch: unknown;
    userId: string | null;
  }): Promise<TraceEditOverlayDto> {
    const parsed = traceEditOverlayPatchSchema.safeParse(patch);
    if (!parsed.success) throw ValidationError.fromZodError(parsed.error);
    if (!patchHasAnyEdit(parsed.data)) {
      throw new ValidationError("A trace correction must change something.");
    }

    const row = await this.repository.upsert({
      projectId,
      traceId,
      patch: parsed.data,
      userId,
    });
    return toDto({ row, patch: parsed.data });
  }

  /**
   * Records a corrected trace output without disturbing the rest of the
   * correction. This is what the "suggest an expected output" flow writes: the
   * annotation stays the record of who suggested what, and the correction stays
   * the current corrected truth for the whole trace.
   */
  async mergeTraceOutputEdit({
    projectId,
    traceId,
    output,
    userId,
  }: {
    projectId: string;
    traceId: string;
    output: string;
    userId: string | null;
  }): Promise<TraceEditOverlayDto> {
    const existing = await this.repository.findByProjectAndTrace({
      projectId,
      traceId,
    });
    const current = existing
      ? (parseTraceEditOverlayPatch(existing.patch) ??
        emptyTraceEditOverlayPatch())
      : emptyTraceEditOverlayPatch();

    const merged: TraceEditOverlayPatch = {
      ...current,
      trace: { ...current.trace, output: { value: output } },
    };

    return this.upsert({ projectId, traceId, patch: merged, userId });
  }

  /**
   * Takes the corrected trace output back off, leaving every other edit in
   * place. This is what clearing a suggestion writes: the reviewer withdrew the
   * output they proposed, not the span renames or deletions someone made in the
   * drawer. When the output was the only edit the row goes with it, so a
   * withdrawn suggestion returns the trace to uncorrected rather than leaving an
   * inert row behind.
   */
  async removeTraceOutputEdit({
    projectId,
    traceId,
    userId,
  }: {
    projectId: string;
    traceId: string;
    userId: string | null;
  }): Promise<TraceEditOverlayDto | null> {
    const existing = await this.repository.findByProjectAndTrace({
      projectId,
      traceId,
    });
    if (!existing) return null;

    const current = parseTraceEditOverlayPatch(existing.patch);
    if (!current?.trace?.output) return null;

    const { output: _removed, ...remainingTraceEdits } = current.trace;
    const next: TraceEditOverlayPatch = {
      ...current,
      ...(remainingTraceEdits.input !== undefined
        ? { trace: remainingTraceEdits }
        : { trace: void 0 }),
    };

    if (!patchHasAnyEdit(next)) {
      await this.repository.delete({ projectId, traceId });
      return null;
    }
    return this.upsert({ projectId, traceId, patch: next, userId });
  }

  async delete({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<void> {
    await this.repository.delete({ projectId, traceId });
  }
}

function toDto({
  row,
  patch,
}: {
  row: TraceEditOverlayRow;
  patch: TraceEditOverlayPatch;
}): TraceEditOverlayDto {
  return {
    traceId: row.traceId,
    patch,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
