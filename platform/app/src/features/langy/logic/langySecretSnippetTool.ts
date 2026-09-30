/**
 * The `secret_snippet` TOOL is the secret snippet card: this module is the
 * bridge, the same shape `langyQuestionTool` and `langyCodeAccessTool` take.
 *
 * Langy calls `secret_snippet` with a one-time reveal id and a template that
 * carries `{{secret}}` where the value goes. The call is all the panel ever
 * stores: the card reads the secret itself, once, through
 * `secrets.revealOnce`, straight into the reader's screen. So the tool part
 * says WHERE the card hangs and WHAT the snippet looks like, and nothing in
 * it, in the events or in the projection is the secret.
 *
 * Pure and JSX-free.
 *
 * Spec: specs/langy/langy-secret-snippet.feature
 */
export const LANGY_SECRET_SNIPPET_TOOL_NAME = "secret_snippet";

/** The placeholder the card fills, as the worker's tool declares it. */
export const LANGY_SECRET_PLACEHOLDER = "{{secret}}";

/** What stands in for a secret that cannot be read any more. */
export const LANGY_SECRET_MASK_FALLBACK_PREFIX = "vk-lw-";

interface SecretSnippetPartLike {
  type?: string;
  toolName?: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
}

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
const COMPLETE_INPUT_STATES = new Set([
  "input-available",
  "output-available",
  "output-error",
  "output-denied",
]);

/** Is this part Langy's `secret_snippet` tool call? */
export function isSecretSnippetToolPart(part: unknown): boolean {
  const p = part as SecretSnippetPartLike;
  if (p?.type === `tool-${LANGY_SECRET_SNIPPET_TOOL_NAME}`) return true;
  return (
    p?.type === "dynamic-tool" && p.toolName === LANGY_SECRET_SNIPPET_TOOL_NAME
  );
}

/**
 * The secret snippet calls a message carries, in order, one card each. A call
 * with no reveal id or no placeholder in its template is left out: the worker
 * refused it with a pushback, so the model asked again with the right shape,
 * and a card for the refused call would show a snippet with nowhere to put
 * the key.
 */
export function secretSnippetCalls(
  parts: readonly unknown[],
): LangySecretSnippetCall[] {
  const calls: LangySecretSnippetCall[] = [];
  for (const part of parts) {
    if (!isSecretSnippetToolPart(part)) continue;
    const p = part as SecretSnippetPartLike;
    if (!COMPLETE_INPUT_STATES.has(p.state ?? "")) continue;
    const input = readSecretSnippetInput(p.input);
    if (!input) continue;
    calls.push({
      callId:
        p.toolCallId ?? `${LANGY_SECRET_SNIPPET_TOOL_NAME}:${input.revealId}`,
      ...input,
    });
  }
  return calls;
}

/** The call's input when it names a reveal and a template with the placeholder. */
function readSecretSnippetInput(
  raw: unknown,
): Pick<LangySecretSnippetCall, "revealId" | "template" | "preview"> | null {
  const input = (raw ?? {}) as {
    revealId?: unknown;
    template?: unknown;
    preview?: unknown;
  };
  const revealId = trimmedString(input.revealId);
  const template = typeof input.template === "string" ? input.template : "";
  if (revealId === "" || !template.includes(LANGY_SECRET_PLACEHOLDER)) {
    return null;
  }
  const preview = trimmedString(input.preview);
  return { revealId, template, preview: preview === "" ? null : preview };
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The snippet with `value` where every placeholder stood. */
export function renderSecretSnippet({
  template,
  value,
}: {
  template: string;
  value: string;
}): string {
  return template.split(LANGY_SECRET_PLACEHOLDER).join(value);
}

/**
 * What the masked snippet shows where the secret was: the display prefix the
 * call named, or the key family's own prefix when it named none, and three
 * dots for the rest.
 */
export function maskedSecretValue(preview: string | null): string {
  return `${preview ?? LANGY_SECRET_MASK_FALLBACK_PREFIX}...`;
}
