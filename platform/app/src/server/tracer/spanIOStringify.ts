import type { Span, SpanInputOutput } from "~/server/tracer/types";

/**
 * The OTel gen_ai semconv (and our canonicaliser, see `_extraction.ts`) split
 * the system prompt out of `gen_ai.input.messages` into the separate
 * `gen_ai.system_instructions` attribute. Reads it back, tolerating both the
 * flat-dotted (`"gen_ai.system_instructions"`) and nested
 * (`{ gen_ai: { system_instructions } }`) param shapes.
 */
function readSystemInstructions(
  params: Record<string, unknown> | null | undefined,
): string | null {
  if (!params) return null;
  const flat = params["gen_ai.system_instructions"];
  if (typeof flat === "string" && flat.trim().length > 0) return flat;
  const genAi = params.gen_ai;
  if (genAi && typeof genAi === "object" && !Array.isArray(genAi)) {
    const nested = (genAi as Record<string, unknown>).system_instructions;
    if (typeof nested === "string" && nested.trim().length > 0) return nested;
  }
  return null;
}

/**
 * Build the display string for a span's input. The canonicaliser strips the
 * system prompt out of the chat transcript into `gen_ai.system_instructions`,
 * so a faithfully-rendered Input panel would silently drop it — the
 * conversation reads as if nothing steered the model. For display we
 * recombine them: when the input is a chat transcript with no system message
 * of its own and the span carries system instructions, prepend them as a
 * leading `system` message. Doing it here (not in the canonicaliser) keeps
 * the stored attribute split semconv-correct while every view mode (pretty /
 * text / json / copy) stays consistent. All other shapes fall through.
 */
export function buildDisplayInput(
  span: Pick<Span, "input" | "params">,
): string | null {
  const io = span.input;
  if (io && io.type === "chat_messages" && Array.isArray(io.value)) {
    const system = readSystemInstructions(span.params ?? null);
    const alreadyHasSystem = io.value.some(
      (m) => !!m && typeof m === "object" && "role" in m && m.role === "system",
    );
    if (system && !alreadyHasSystem) {
      return JSON.stringify([{ role: "system", content: system }, ...io.value]);
    }
  }
  return stringifySpanIO(io);
}

/**
 * Renders a canonical captured value as the single string the v2 drawer shows
 * and edits. Pure and dependency-free so the client applies a correction with
 * exactly the same rendering the server used for the original.
 */
export function stringifySpanIO(
  io: SpanInputOutput | null | undefined,
): string | null {
  if (!io) return null;
  switch (io.type) {
    case "text":
      return String(io.value);
    case "chat_messages":
      return JSON.stringify(io.value);
    case "json":
      return JSON.stringify(io.value);
    case "raw":
      return String(io.value);
    case "guardrail_result":
    case "evaluation_result":
      return JSON.stringify(io.value);
    case "list":
      return io.value.map((v) => stringifySpanIO(v)).join("\n");
    default:
      return null;
  }
}
