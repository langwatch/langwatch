import { z } from "zod";
import type { TraceEditSpanField } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";

/**
 * The parts of a trace a comment can be about.
 *
 * - `span`: a whole span. `anchorId` is the span id, `anchorPath` is unused.
 * - `field`: one field of a span or of the trace. `anchorId` is the span id, or
 *   the trace id for the trace's own fields; `anchorPath` names the field
 *   (`output`, `params.temperature`, `metadata.environment`).
 * - `message`: one message inside a transcript. `anchorId` is the trace whose
 *   turn holds it, `anchorPath` is the message's key.
 *
 * A comment with no anchor at all is about the trace as a whole, which is what
 * every annotation written before this feature is.
 */
export const ANNOTATION_ANCHOR_KINDS = ["span", "field", "message"] as const;

export const annotationAnchorKindSchema = z.enum(ANNOTATION_ANCHOR_KINDS);

export type AnnotationAnchorKind = z.infer<typeof annotationAnchorKindSchema>;

/**
 * The anchor as it travels on the wire and as it is stored: the same three flat
 * fields on both sides, so a draft, a create and a row all describe an anchor
 * the same way.
 */
export const annotationAnchorColumnsSchema = z.object({
  anchorKind: annotationAnchorKindSchema.optional(),
  anchorId: z.string().min(1).optional(),
  anchorPath: z.string().min(1).optional(),
});

export type AnnotationAnchorColumns = z.infer<typeof annotationAnchorColumnsSchema>;

/**
 * Refuses half an anchor. A kind without the element it names would store a
 * comment about nothing, and an element without a kind would store one nothing
 * can resolve, so both are rejected at the boundary rather than persisted and
 * discovered by the reader.
 */
export function refineAnnotationAnchorColumns(
  value: AnnotationAnchorColumns,
  ctx: z.RefinementCtx,
): void {
  if (value.anchorKind && !value.anchorId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["anchorId"],
      message: "An anchored comment must name the part of the trace it is on.",
    });
  }
  if (!value.anchorKind && (value.anchorId || value.anchorPath)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["anchorKind"],
      message: "A comment about a part of the trace must say what kind it is.",
    });
  }
}

/**
 * Which comments a read wants: `trace` only the ones about the trace as a
 * whole, `all` every comment including the ones anchored to a part of it.
 *
 * Every surface that reads a trace's comments reads `all` and labels each one
 * with the part it is about: an anchored comment is the primary way a reviewer
 * speaks, so a list that hid them would answer with silence exactly when
 * someone had spoken. `trace` is for a caller that wants only what was said
 * about the trace as a whole.
 */
export const ANNOTATION_ANCHOR_SCOPES = ["trace", "all"] as const;

export const annotationAnchorScopeSchema = z.enum(ANNOTATION_ANCHOR_SCOPES);

export type AnnotationAnchorScope = z.infer<typeof annotationAnchorScopeSchema>;

/**
 * The `where` fragment for an anchor scope. `trace` matches only unanchored
 * rows, which also leaves out a kind this build does not recognise: an anchor
 * it cannot read is not a comment about the whole trace either.
 */
export function annotationAnchorScopeWhere(
  scope: AnnotationAnchorScope,
): { anchorKind: null } | Record<string, never> {
  return scope === "trace" ? { anchorKind: null } : {};
}

/**
 * The stored anchor as this build can read it. An `anchorKind` written by a
 * newer build, or by hand, reads as no anchor at all: the comment is still the
 * reviewer's words about this trace, so degrading it to a comment about the
 * trace as a whole keeps the list the reader asked for, where failing the parse
 * would take every other comment on the trace down with it.
 *
 * Same contract as `parseTraceEditOverlayPatch` for a stored correction.
 */
export function readableAnnotationAnchor(row: {
  anchorKind: string | null;
  anchorId: string | null;
  anchorPath: string | null;
}): {
  anchorKind: AnnotationAnchorKind | null;
  anchorId: string | null;
  anchorPath: string | null;
} {
  const kind = annotationAnchorKindSchema.safeParse(row.anchorKind);
  if (!kind.success || !row.anchorId) {
    return { anchorKind: null, anchorId: null, anchorPath: null };
  }
  return {
    anchorKind: kind.data,
    anchorId: row.anchorId,
    anchorPath: row.anchorPath,
  };
}

/**
 * A read row with its anchor normalised. Applied to the comments of a trace,
 * which is the one read that shows a reader every comment they left.
 */
export function withReadableAnnotationAnchor<
  T extends {
    anchorKind: string | null;
    anchorId: string | null;
    anchorPath: string | null;
  },
>(
  row: T,
): Omit<T, "anchorKind" | "anchorId" | "anchorPath"> & {
  anchorKind: AnnotationAnchorKind | null;
  anchorId: string | null;
  anchorPath: string | null;
} {
  return { ...row, ...readableAnnotationAnchor(row) };
}

/**
 * The fields a suggestion can correct. A trace and a span spell their captured
 * input and output the same way, so one union names both.
 */
export type AnnotationSuggestionField = Extract<TraceEditSpanField, "input" | "output">;

/**
 * Where a suggestion left with a comment belongs in the trace's correction.
 *
 * A comment on a field corrects that field of what it is anchored to: the
 * trace's own input or output, or a span's. A comment about the whole trace
 * names no field, and a suggestion left on it corrects the trace output, which
 * is the one thing a reviewer with the whole trace in view can be proposing.
 *
 * Everything else returns null and carries no correction: a span with no field
 * named, an attribute row (the correction replaces a span's whole parameter
 * map, so one key of it is not something a suggestion can express), a message,
 * and a field this build does not know. The composer offers no suggestion on
 * any of them, and the boundary agrees rather than guessing at a target.
 */
export function resolveAnnotationSuggestionTarget({
  traceId,
  anchorKind,
  anchorId,
  anchorPath,
}: {
  traceId: string;
  anchorKind?: string | null;
  anchorId?: string | null;
  anchorPath?: string | null;
}):
  | { kind: "trace"; field: AnnotationSuggestionField }
  | { kind: "span"; spanId: string; field: AnnotationSuggestionField }
  | null {
  const anchor = readableAnnotationAnchor({
    anchorKind: anchorKind ?? null,
    anchorId: anchorId ?? null,
    anchorPath: anchorPath ?? null,
  });

  if (!anchor.anchorKind) return { kind: "trace", field: "output" };
  if (anchor.anchorKind !== "field" || !anchor.anchorId) return null;
  if (anchor.anchorPath !== "input" && anchor.anchorPath !== "output") {
    return null;
  }

  return anchor.anchorId === traceId
    ? { kind: "trace", field: anchor.anchorPath }
    : { kind: "span", spanId: anchor.anchorId, field: anchor.anchorPath };
}
