import type { Protections, PromptStudioSpanResult } from "@langwatch/trace-contract";

import {
  categoryVisibility,
  createAttributeRedactor,
} from "../../../rules/trace-attribute-redaction.rules.ts";
import type { PromptStudioSpanRow } from "./trace-legacy-prompt-studio-span.rules.ts";

/**
 * Why a span's content is not handed to the prompt playground (#8549):
 * the viewer may not read one of its content categories, or the span started
 * before the plan's visibility window.
 */
export type PromptStudioWithholding = "content_hidden" | "outside_visibility_window";

/**
 * Whether the viewer may not read some category of a prompt's content. The
 * playground opens the captured conversation as an editable prompt (input,
 * output, system prompt, tool calls), so a viewer the drawer would show
 * placeholders gets no prompt at all rather than a half-redacted one.
 */
export function promptStudioContentHidden(protections: Protections): boolean {
  const categories = categoryVisibility(protections);
  return !(
    categories.input.canSee &&
    categories.output.canSee &&
    categories.system.canSee &&
    categories.tools.canSee
  );
}

/**
 * The rows with every attribute the viewer's attribute policies hide replaced
 * by the drawer's placeholder, before any prompt variable or parameter is
 * read out of them. Rows return unchanged when nothing is hidden.
 */
export function redactPromptStudioRows(
  rows: PromptStudioSpanRow[],
  protections: Protections,
): PromptStudioSpanRow[] {
  if ((protections.hiddenAttributes?.length ?? 0) === 0) return rows;
  const redact = createAttributeRedactor({ hidden: protections.hiddenAttributes });
  return rows.map((row) => {
    const SpanAttributes = redact(row.SpanAttributes);
    return SpanAttributes === row.SpanAttributes ? row : { ...row, SpanAttributes };
  });
}

/**
 * Why this derived span is withheld from the viewer, or null when they may
 * open it. Under a visibility window, a span whose start is unknown is
 * withheld: nothing shows it is inside the window.
 */
export function promptStudioSpanWithholding({
  span,
  protections,
}: {
  span: PromptStudioSpanResult;
  protections: Protections;
}): PromptStudioWithholding | null {
  if (promptStudioContentHidden(protections)) return "content_hidden";
  const cutoffMs = protections.visibilityCutoffMs;
  if (cutoffMs === null || cutoffMs === undefined) return null;
  const startedAt = Number(span.timestamps?.started_at);
  if (!Number.isFinite(startedAt) || startedAt < cutoffMs) return "outside_visibility_window";
  return null;
}
