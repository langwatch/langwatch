import { ValidationError } from "@langwatch/handled-error";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  TraceEditOverlayRepository,
  type TraceEditOverlayRow,
} from "../repositories/prisma/prisma.trace-edit-overlay.repository";
import {
  emptyTraceEditOverlayPatch,
  encodeSpanIOFromEditedText,
  parseTraceEditOverlayPatch,
  patchHasAnyEdit,
  type TraceEditOverlayDto,
  type TraceEditOverlayPatch,
  type TraceEditSpanPatch,
  traceEditOverlayPatchSchema,
} from "@langwatch/trace-contract";

/** The fields a suggestion can correct, on the trace itself or on one of its
 *  spans: the two that hold a captured value a reviewer reads and can rewrite
 *  as text. */
export type TraceEditIOField = "input" | "output";

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
    const row = await this.repository.tryFindByProjectAndTrace({
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
   * Records a corrected trace input or output without disturbing the rest of
   * the correction. This is what a suggestion left on the trace's own field
   * writes: the annotation stays the record of who suggested what, and the
   * correction stays the current corrected truth for the whole trace.
   */
  async mergeTraceIOEdit({
    projectId,
    traceId,
    field,
    value,
    userId,
  }: {
    projectId: string;
    traceId: string;
    field: TraceEditIOField;
    value: string;
    userId: string | null;
  }): Promise<TraceEditOverlayDto> {
    const current = await this.currentPatch({ projectId, traceId });

    const merged: TraceEditOverlayPatch = {
      ...current,
      trace: { ...current.trace, [field]: { value } },
    };

    return this.upsert({ projectId, traceId, patch: merged, userId });
  }

  /**
   * Takes a corrected trace input or output back off, leaving every other edit
   * in place. This is what clearing a suggestion writes: the reviewer withdrew
   * the value they proposed, not the other trace fields, nor the span renames
   * or deletions someone made in the drawer. When that field was the only edit
   * the row goes with it, so a withdrawn suggestion returns the trace to
   * uncorrected rather than leaving an inert row behind.
   */
  async removeTraceIOEdit({
    projectId,
    traceId,
    field,
    userId,
  }: {
    projectId: string;
    traceId: string;
    field: TraceEditIOField;
    userId: string | null;
  }): Promise<TraceEditOverlayDto | null> {
    const existing = await this.repository.tryFindByProjectAndTrace({
      projectId,
      traceId,
    });
    if (!existing) return null;

    const current = parseTraceEditOverlayPatch(existing.patch);
    if (!current?.trace?.[field]) return null;

    const { [field]: _removed, ...remainingTraceEdits } = current.trace;
    const hasRemainingTraceEdits = Object.values(remainingTraceEdits).some(
      (value) => value !== undefined,
    );
    const next: TraceEditOverlayPatch = {
      ...current,
      ...(hasRemainingTraceEdits ? { trace: remainingTraceEdits } : { trace: void 0 }),
    };

    if (!patchHasAnyEdit(next)) {
      await this.repository.delete({ projectId, traceId });
      return null;
    }
    return this.upsert({ projectId, traceId, patch: next, userId });
  }

  /**
   * Records a corrected span field without disturbing the rest of the
   * correction. This is what a suggestion left with a comment on a span's input
   * or output writes: the comment stays the record of who asked for the change,
   * the correction is what the dataset reads.
   *
   * The text is encoded with the same encoder the drawer uses, so a transcript
   * typed into the box comes back as a transcript rather than as a string of
   * JSON. A value the correction already holds for that field is the original
   * the encoding reads, which keeps a field a reviewer already turned into
   * plain text from being re-read as structure on the next save.
   */
  async mergeSpanFieldEdit({
    projectId,
    traceId,
    spanId,
    field,
    text,
    userId,
  }: {
    projectId: string;
    traceId: string;
    spanId: string;
    field: TraceEditIOField;
    text: string;
    userId: string | null;
  }): Promise<TraceEditOverlayDto> {
    const current = await this.currentPatch({ projectId, traceId });
    const existingSpan = current.spans.find((span) => span.spanId === spanId);

    const edited: TraceEditSpanPatch = {
      ...(existingSpan ?? { spanId }),
      [field]: encodeSpanIOFromEditedText({
        text,
        original: existingSpan?.[field] ?? null,
      }),
    };
    const merged: TraceEditOverlayPatch = {
      ...current,
      spans: existingSpan
        ? current.spans.map((span) => (span.spanId === spanId ? edited : span))
        : [...current.spans, edited],
    };

    return this.upsert({ projectId, traceId, patch: merged, userId });
  }

  /**
   * Takes a corrected span field back off, leaving every other edit in place.
   * A span left with no corrected field at all goes with it, and a correction
   * left with no edits returns the trace to uncorrected, so a withdrawn
   * suggestion never leaves an inert row behind.
   */
  async removeSpanFieldEdit({
    projectId,
    traceId,
    spanId,
    field,
    userId,
  }: {
    projectId: string;
    traceId: string;
    spanId: string;
    field: TraceEditIOField;
    userId: string | null;
  }): Promise<TraceEditOverlayDto | null> {
    const existing = await this.repository.tryFindByProjectAndTrace({
      projectId,
      traceId,
    });
    if (!existing) return null;

    const current = parseTraceEditOverlayPatch(existing.patch);
    const existingSpan = current?.spans.find((span) => span.spanId === spanId);
    if (!current || existingSpan?.[field] === undefined) return null;

    const { [field]: _removed, ...remainingSpanEdits } = existingSpan;
    const spanKeepsEdits = Object.entries(remainingSpanEdits).some(
      ([key, value]) => key !== "spanId" && value !== undefined,
    );
    const next: TraceEditOverlayPatch = {
      ...current,
      spans: spanKeepsEdits
        ? current.spans.map((span) =>
            span.spanId === spanId ? (remainingSpanEdits as TraceEditSpanPatch) : span,
          )
        : current.spans.filter((span) => span.spanId !== spanId),
    };

    if (!patchHasAnyEdit(next)) {
      await this.repository.delete({ projectId, traceId });
      return null;
    }
    return this.upsert({ projectId, traceId, patch: next, userId });
  }

  async delete({ projectId, traceId }: { projectId: string; traceId: string }): Promise<void> {
    await this.repository.delete({ projectId, traceId });
  }

  /**
   * The trace's correction as a patch this build can merge onto. A row it
   * cannot interpret is replaced wholesale rather than merged into, the same way
   * it reads as no correction everywhere else.
   */
  private async currentPatch({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<TraceEditOverlayPatch> {
    const existing = await this.repository.tryFindByProjectAndTrace({
      projectId,
      traceId,
    });
    if (!existing) return emptyTraceEditOverlayPatch();
    return parseTraceEditOverlayPatch(existing.patch) ?? emptyTraceEditOverlayPatch();
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
