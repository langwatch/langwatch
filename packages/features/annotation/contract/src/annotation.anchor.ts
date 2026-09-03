import { z } from "zod";

export const ANNOTATION_ANCHOR_KINDS = ["span", "field", "message"] as const;
export const annotationAnchorKinds = ANNOTATION_ANCHOR_KINDS;
export const annotationAnchorKindSchema = z.enum(annotationAnchorKinds);
export type AnnotationAnchorKind = z.infer<typeof annotationAnchorKindSchema>;

export type AnnotationAnchorStorage = {
  anchorKind: string | null;
  anchorId: string | null;
  anchorPath: string | null;
};

export type ReadableAnnotationAnchor = {
  anchorKind: AnnotationAnchorKind | null;
  anchorId: string | null;
  anchorPath: string | null;
};

export function refineAnnotationAnchorColumns(
  value: AnnotationAnchorColumns,
  context: z.RefinementCtx,
): void {
  if (value.anchorKind && !value.anchorId) {
    context.addIssue({
      code: "custom",
      path: ["anchorId"],
      message: "An anchored comment must name the part of the trace it is on.",
    });
  }
  if (!value.anchorKind && (value.anchorId || value.anchorPath)) {
    context.addIssue({
      code: "custom",
      path: ["anchorKind"],
      message: "A comment about a part of the trace must say what kind it is.",
    });
  }
}

export const annotationAnchorColumnsSchema = z
  .object({
    anchorKind: annotationAnchorKindSchema.optional().nullable(),
    anchorId: z.string().min(1).optional().nullable(),
    anchorPath: z.string().min(1).optional().nullable(),
  })
  .superRefine(refineAnnotationAnchorColumns);
export type AnnotationAnchorColumns = z.infer<typeof annotationAnchorColumnsSchema>;

export const ANNOTATION_ANCHOR_SCOPES = ["trace", "all"] as const;
export const annotationAnchorScopes = ANNOTATION_ANCHOR_SCOPES;
export const annotationAnchorScopeSchema = z.enum(annotationAnchorScopes);
export type AnnotationAnchorScope = z.infer<typeof annotationAnchorScopeSchema>;

export function readableAnnotationAnchor(row: AnnotationAnchorStorage): ReadableAnnotationAnchor {
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

export function withReadableAnnotationAnchor<T extends AnnotationAnchorStorage>(
  row: T,
): T & ReadableAnnotationAnchor {
  return { ...row, ...readableAnnotationAnchor(row) };
}

export type AnnotationSuggestionField = "input" | "output";

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
  if (anchor.anchorPath !== "input" && anchor.anchorPath !== "output") return null;

  return anchor.anchorId === traceId
    ? { kind: "trace", field: anchor.anchorPath }
    : { kind: "span", spanId: anchor.anchorId, field: anchor.anchorPath };
}

export interface AnnotationSuggestionSource {
  expectedOutput?: string | null;
  anchorKind?: string | null;
  anchorId?: string | null;
  anchorPath?: string | null;
}

export function annotationSuggestedOutput({
  annotation,
  traceId,
}: {
  annotation: AnnotationSuggestionSource;
  traceId: string;
}): string | null {
  const anchor = readableAnnotationAnchor({
    anchorKind: annotation.anchorKind ?? null,
    anchorId: annotation.anchorId ?? null,
    anchorPath: annotation.anchorPath ?? null,
  });

  if (!anchor.anchorKind) return annotation.expectedOutput ?? null;

  const isTraceOutput =
    anchor.anchorKind === "field" && anchor.anchorId === traceId && anchor.anchorPath === "output";

  return isTraceOutput ? (annotation.expectedOutput ?? null) : null;
}

export interface AnnotationAnchorRef {
  anchorKind: AnnotationAnchorKind | null;
  anchorId: string | null;
  anchorPath: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  error: "Error",
  input: "Input",
  metadata: "Metadata",
  name: "Name",
  output: "Output",
  params: "Parameters",
  type: "Type",
};

const ANCHOR_SEPARATOR = " · ";

export function describeAnnotationAnchor({
  anchor,
  traceId,
  spanName,
  selfLabel = "Trace",
  withIds = false,
}: {
  anchor: AnnotationAnchorRef;
  traceId: string;
  spanName?: string | null;
  selfLabel?: string | null;
  withIds?: boolean;
}): string | null {
  if (!anchor.anchorKind || !anchor.anchorId) return null;
  if (anchor.anchorKind === "message") return "Message";

  const owner = describeAnchorOwner({
    anchorId: anchor.anchorId,
    traceId,
    spanName,
    selfLabel,
    withIds,
  });
  if (anchor.anchorKind === "span") return owner;

  const path = describeFieldPath(anchor.anchorPath);
  if (!owner) return path;
  return path ? `${owner}${ANCHOR_SEPARATOR}${path}` : owner;
}

function describeAnchorOwner({
  anchorId,
  traceId,
  spanName,
  selfLabel,
  withIds,
}: {
  anchorId: string;
  traceId: string;
  spanName?: string | null;
  selfLabel: string | null;
  withIds: boolean;
}): string | null {
  if (anchorId === traceId) {
    if (!selfLabel) return null;
    return withIds ? `${selfLabel} (${shortId(traceId)})` : selfLabel;
  }
  if (!withIds) return `Span ${spanName ?? anchorId}`;
  return spanName ? `${spanName} span (${shortId(anchorId)})` : `span (${shortId(anchorId)})`;
}

function describeFieldPath(anchorPath: string | null): string | null {
  if (!anchorPath) return null;
  const separatorAt = anchorPath.indexOf(".");
  if (separatorAt === -1) return FIELD_LABELS[anchorPath] ?? anchorPath;
  const field = anchorPath.slice(0, separatorAt);
  const key = anchorPath.slice(separatorAt + 1);
  return `${FIELD_LABELS[field] ?? field}${ANCHOR_SEPARATOR}${key}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
