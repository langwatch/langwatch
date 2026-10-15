/**
 * The `secret_snippet` tool is the secret snippet card. The call carries a one-time reveal id and
 * a template with `{{secret}}` where the value goes; the card reads the secret itself, once.
 * Spec: specs/langy/langy-secret-snippet.feature
 */
import { z } from "zod";

export const LANGY_SECRET_SNIPPET_TOOL_NAME = "secret_snippet";

/** The placeholder the card fills, as the worker's tool declares it. */
export const LANGY_SECRET_PLACEHOLDER = "{{secret}}";

/** What stands in for a secret that cannot be read any more. */
export const LANGY_SECRET_MASK_FALLBACK_PREFIX = "vk-lw-";

export interface LangySecretSnippetCall {
  callId: string;
  revealId: string;
  template: string;
  /** The display prefix shown in place of the secret once it is gone. */
  preview: string | null;
}

/**
 * States whose `input` is COMPLETE. A call still streaming its input has half
 * a template, and a card drawn from that would show a broken snippet.
 */
const COMPLETE_INPUT_STATES = [
  "input-available",
  "output-available",
  "output-error",
  "output-denied",
];

const toolPartSchema = z.object({
  type: z.string(),
  toolName: z.string().optional(),
  state: z.string().optional(),
  toolCallId: z.string().optional(),
  input: z.unknown(),
});

const trimmed = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : ""),
  z.string(),
);

const secretSnippetInputSchema = z.object({
  revealId: trimmed,
  template: z.preprocess((value) => (typeof value === "string" ? value : ""), z.string()),
  preview: trimmed,
});

function readToolPart(part: unknown) {
  const parsed = toolPartSchema.safeParse(part);
  if (!parsed.success) return null;
  const { type, toolName } = parsed.data;
  const named =
    type === `tool-${LANGY_SECRET_SNIPPET_TOOL_NAME}` ||
    (type === "dynamic-tool" && toolName === LANGY_SECRET_SNIPPET_TOOL_NAME);
  return named ? parsed.data : null;
}

/** Is this part Langy's `secret_snippet` tool call? */
export function isSecretSnippetToolPart(part: unknown): boolean {
  return readToolPart(part) !== null;
}

/**
 * The secret snippet calls a message carries, in order, one card each. A call with no reveal id or
 * no placeholder was refused by the worker with a pushback, so it draws no card.
 */
export function secretSnippetCalls(parts: readonly unknown[]): LangySecretSnippetCall[] {
  const calls: LangySecretSnippetCall[] = [];
  for (const part of parts) {
    const toolPart = readToolPart(part);
    if (!toolPart || !COMPLETE_INPUT_STATES.includes(toolPart.state ?? "")) continue;
    const input = secretSnippetInputSchema.safeParse(toolPart.input ?? {});
    if (!input.success) continue;
    const { revealId, template, preview } = input.data;
    if (revealId === "" || !template.includes(LANGY_SECRET_PLACEHOLDER)) continue;
    calls.push({
      callId: toolPart.toolCallId ?? `${LANGY_SECRET_SNIPPET_TOOL_NAME}:${revealId}`,
      revealId,
      template,
      preview: preview === "" ? null : preview,
    });
  }
  return calls;
}

/** The snippet with `value` where every placeholder stood. */
export function renderSecretSnippet({ template, value }: { template: string; value: string }) {
  return template.split(LANGY_SECRET_PLACEHOLDER).join(value);
}

/** The masked value: the call's display prefix, or the key family's own, and three dots. */
export function maskedSecretValue(preview: string | null): string {
  return `${preview ?? LANGY_SECRET_MASK_FALLBACK_PREFIX}...`;
}
