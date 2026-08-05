import { z } from "zod";
import {
  type ChatMessage,
  chatMessageSchema,
  errorCaptureSchema,
  type SpanInputOutput,
  spanInputOutputSchema,
  spanTypesSchema,
} from "~/server/tracer/types";

/**
 * The only patch version this build understands. A row stored under any other
 * version reads as "no correction" rather than being coerced, so an older
 * deployment never applies a patch it cannot interpret.
 */
export const TRACE_EDIT_OVERLAY_PATCH_VERSION = 1;

/**
 * Hard ceiling on one stored patch. A correction replaces whole fields, so a
 * reviewer pasting a very large transcript into every span could otherwise
 * push megabytes into a Postgres row that is read on every dataset add.
 */
export const TRACE_EDIT_OVERLAY_MAX_PATCH_BYTES = 2 * 1024 * 1024;

/**
 * Trace-level input/output, matching the canonical `Trace.input` /
 * `Trace.output` shape (`{ value: string }`).
 */
const traceIOEditSchema = z.object({ value: z.string() });

/**
 * One span's correction. `spanId` identifies the span; every other key is
 * optional:
 *   - key absent  -> that field is untouched
 *   - key present -> that field is replaced wholesale
 * A field that can be absent from a span in the first place — name, input,
 * output, params, error — also takes null, which clears it. `type` does not:
 * every span has one, so there is nothing for a cleared type to mean.
 * Field-level replacement (rather than a character diff) is what keeps a
 * correction meaningful while spans are still being ingested.
 */
export const traceEditSpanPatchSchema = z.object({
  spanId: z.string().min(1),
  name: z.string().nullable().optional(),
  type: spanTypesSchema.optional(),
  input: spanInputOutputSchema.nullable().optional(),
  output: spanInputOutputSchema.nullable().optional(),
  params: z.record(z.string(), z.unknown()).nullable().optional(),
  error: errorCaptureSchema.nullable().optional(),
});

export type TraceEditSpanPatch = z.infer<typeof traceEditSpanPatchSchema>;

/** Every span field a correction can carry, in the order the UI presents them. */
export const TRACE_EDIT_SPAN_FIELDS = [
  "name",
  "type",
  "input",
  "output",
  "params",
  "error",
] as const;

export type TraceEditSpanField = (typeof TRACE_EDIT_SPAN_FIELDS)[number];

/** Every trace-level field a correction can carry, in presentation order. */
export const TRACE_EDIT_TRACE_FIELDS = ["input", "output", "metadata"] as const;

export type TraceEditTraceField = (typeof TRACE_EDIT_TRACE_FIELDS)[number];

/**
 * The trace's own metadata as the correction leaves it, in the bare keys the
 * canonical `Trace.metadata` uses (`thread_id`, `labels`, and whatever the
 * caller sent). It is an overlay on the map rather than a replacement of it:
 * a key the correction names replaces what the trace recorded, a `null` value
 * removes that key, and a key the correction does not name stays as captured.
 * That is what lets a reviewer fix one label without the correction having to
 * restate every key the platform stamped. `null` in place of the whole map
 * clears the trace's metadata.
 */
const traceMetadataEditSchema = z.record(z.string(), z.unknown());

const traceEditOverlayPatchObjectSchema = z.object({
  version: z.literal(TRACE_EDIT_OVERLAY_PATCH_VERSION),
  trace: z
    .object({
      input: traceIOEditSchema.optional(),
      output: traceIOEditSchema.optional(),
      metadata: traceMetadataEditSchema.nullable().optional(),
    })
    .optional(),
  spans: z.array(traceEditSpanPatchSchema).default([]),
  /**
   * Spans the reviewer removed. Only the deletion roots are stored; the
   * descendants are resolved when the patch is applied, so a subtree that grew
   * after the correction was saved is still dropped.
   */
  deletedSpanIds: z.array(z.string().min(1)).default([]),
});

/**
 * Serialized size guard. UTF-8 uses between one and three bytes per UTF-16
 * code unit, so the two cheap comparisons decide every ordinary patch and only
 * a value inside the narrow band pays for an encode.
 */
function patchExceedsSizeLimit(value: unknown): boolean {
  const json = JSON.stringify(value) ?? "";
  if (json.length > TRACE_EDIT_OVERLAY_MAX_PATCH_BYTES) return true;
  if (json.length * 3 <= TRACE_EDIT_OVERLAY_MAX_PATCH_BYTES) return false;
  return (
    new TextEncoder().encode(json).length > TRACE_EDIT_OVERLAY_MAX_PATCH_BYTES
  );
}

export const traceEditOverlayPatchSchema =
  traceEditOverlayPatchObjectSchema.superRefine((patch, ctx) => {
    if (patchExceedsSizeLimit(patch)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Trace correction is larger than the ${Math.round(
          TRACE_EDIT_OVERLAY_MAX_PATCH_BYTES / (1024 * 1024),
        )} MB limit.`,
      });
    }
  });

export type TraceEditOverlayPatch = z.infer<typeof traceEditOverlayPatchSchema>;

/** An empty, valid patch. The starting point for a merge onto a trace that has
 *  no correction yet. */
export function emptyTraceEditOverlayPatch(): TraceEditOverlayPatch {
  return {
    version: TRACE_EDIT_OVERLAY_PATCH_VERSION,
    spans: [],
    deletedSpanIds: [],
  };
}

/**
 * Reads a stored patch. A row written by a future version, hand-edited, or
 * corrupted returns null: absence of a correction is a normal state the whole
 * read path already handles, so degrading is strictly better than failing a
 * trace read.
 */
export function parseTraceEditOverlayPatch(
  value: unknown,
): TraceEditOverlayPatch | null {
  const parsed = traceEditOverlayPatchSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** True when the patch actually changes something. A patch that changes
 *  nothing is rejected on write and treated as absent on read. */
export function patchHasAnyEdit(patch: TraceEditOverlayPatch): boolean {
  if (patch.deletedSpanIds.length > 0) return true;
  if (
    TRACE_EDIT_TRACE_FIELDS.some((field) => patch.trace?.[field] !== undefined)
  ) {
    return true;
  }
  return patch.spans.some((span) =>
    TRACE_EDIT_SPAN_FIELDS.some((field) => span[field] !== undefined),
  );
}

/**
 * Chat transcripts are the only structured shape we recover from edited text,
 * and only when every entry looks like a message. `chatMessageSchema` leaves
 * every key optional, so a plain array of unrelated objects would otherwise
 * parse clean and silently lose its contents.
 */
function asChatMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const looksLikeTranscript = value.every(
    (entry) =>
      !!entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      "role" in entry,
  );
  if (!looksLikeTranscript) return null;
  const parsed = z.array(chatMessageSchema).safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Turns the text a reviewer typed back into a canonical captured value.
 *
 * The drawer edits strings while the trace stores typed values, so the same
 * encoder runs on the client (before the patch is sent) and on the server
 * (when a suggestion is merged), keeping one definition of what a given piece
 * of text means. `raw` and `text` stay verbatim: they were never structured,
 * and re-reading `"42"` as JSON would change what the trace says.
 */
export function encodeSpanIOFromEditedText({
  text,
  original,
}: {
  text: string;
  original?: SpanInputOutput | null;
}): SpanInputOutput {
  if (original?.type === "raw") return { type: "raw", value: text };
  if (original?.type === "text") return { type: "text", value: text };

  const trimmed = text.trim();
  if (trimmed.length === 0) return { type: "text", value: text };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { type: "text", value: text };
  }

  const chatMessages = asChatMessages(parsed);
  if (chatMessages) return { type: "chat_messages", value: chatMessages };

  const json = spanInputOutputSchema.safeParse({ type: "json", value: parsed });
  if (json.success) return json.data;
  return { type: "text", value: text };
}
