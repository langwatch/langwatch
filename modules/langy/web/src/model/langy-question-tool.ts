/**
 * The `question` TOOL is the choices card (ADR-060 §6) — this module is the bridge.
 */
import {
  type LangyCardPart,
  type LangyDerivedChoicesCard,
  parseLangyCardPart,
} from "@langwatch/langy-contract";
import { z } from "zod";

const questionToolPartSchema = z
  .object({
    type: z.string(),
    toolName: z.string().optional(),
    state: z.string().optional(),
    toolCallId: z.string().optional(),
    input: z.unknown().optional(),
  })
  .loose();

/**
 * States whose `input` is COMPLETE. While the call is still streaming its
 * input the JSON may be half a question — nothing renders from that.
 */
const COMPLETE_INPUT_STATES = new Set([
  "input-available",
  "output-available",
  "output-error",
  "output-denied",
]);

/** Is this part the agent's `question` tool call? */
export function isQuestionToolPart(part: unknown): boolean {
  const parsed = questionToolPartSchema.safeParse(part);
  if (!parsed.success) return false;

  if (parsed.data.type === "tool-question") return true;
  return parsed.data.type === "dynamic-tool" && parsed.data.toolName === "question";
}

const rawQuestionOptionSchema = z
  .object({
    label: z.unknown().optional(),
    description: z.unknown().optional(),
  })
  .loose();
const rawQuestionSchema = z
  .object({
    question: z.unknown().optional(),
    header: z.unknown().optional(),
    options: z.unknown().optional(),
    multiple: z.unknown().optional(),
    custom: z.unknown().optional(),
  })
  .loose();
const questionListSchema = z
  .object({ questions: z.array(z.unknown()) })
  .loose()
  .transform(({ questions }) => questions);
const singleQuestionSchema = z
  .object({ question: z.unknown() })
  .loose()
  .transform((question) => [question]);

/** The first of a list of maybe-strings that carries text, or null. */
function firstNonEmpty(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

/** The questions a call carries, read as a list or as one on its own. */
function readCandidates({
  list,
  single,
}: {
  list: { success: boolean; data?: unknown[] };
  single: { success: boolean; data?: unknown[] };
}): unknown[] {
  if (list.success) return list.data ?? [];
  return single.success ? (single.data ?? []) : [];
}

function parseQuestions(input: unknown) {
  const list = questionListSchema.safeParse(input);
  const single = singleQuestionSchema.safeParse(input);
  const candidates = readCandidates({ list, single });
  return candidates.flatMap((candidate) => {
    const parsed = rawQuestionSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

type RawQuestion = z.infer<typeof rawQuestionSchema>;

/** The options a raw question carries, filtered to the ones with a usable label. */
function questionCardOptions(raw: RawQuestion): LangyDerivedChoicesCard["options"] {
  const parsedOptions = z.array(rawQuestionOptionSchema).safeParse(raw.options);
  return (parsedOptions.success ? parsedOptions.data : [])
    .flatMap((option) => {
      if (typeof option.label !== "string" || option.label.trim() === "") return [];
      return [{ label: option.label, description: option.description }];
    })
    .map((option, optionIndex) => ({
      id: `opt-${optionIndex + 1}`,
      label: option.label,
      ...(typeof option.description === "string" && option.description.trim() !== ""
        ? { description: option.description }
        : {}),
    }));
}

/** One question, index-scoped, turned into its stamped choices card part (or null when
 *  it has no question text or no usable options). */
function buildQuestionCardPart({
  raw,
  index,
  toolCallId,
}: {
  raw: RawQuestion;
  index: number;
  toolCallId: string | undefined;
}): LangyCardPart | null {
  // `question` is the full text; `header` is the tool's short label. The card
  // has one line, so the full text wins and the header only stands in when
  // the model sent nothing else.
  const question = firstNonEmpty([raw.question, raw.header]);
  if (!question) return null;

  const options = questionCardOptions(raw);
  if (options.length === 0) return null;

  // Stable across renders and rehydration: the recorded selection binds by
  // this id, so it must derive from the part's own durable identity.
  const blockId = `question:${toolCallId ?? question}:${index}`;
  const card: LangyDerivedChoicesCard = {
    kind: "choices",
    blockId,
    question,
    options,
    ...(raw.multiple === true ? { multiSelect: true } : {}),
    // The tool's TUI always accepts a typed answer; only an explicit
    // `custom: false` closes that door here.
    ...(raw.custom !== false ? { allowOther: true } : {}),
  };
  return parseLangyCardPart({
    type: "langy-card",
    blockId,
    kind: "choices",
    provenance: "derived",
    card,
  });
}

/**
 * The stamped card parts a `question` tool call renders as — one choices card per
 * question it carries.
 */
export function questionToolCardParts(part: unknown): LangyCardPart[] {
  const parsedPart = questionToolPartSchema.safeParse(part);
  if (!parsedPart.success || !isQuestionToolPart(parsedPart.data)) return [];

  const toolPart = parsedPart.data;
  if (!COMPLETE_INPUT_STATES.has(toolPart.state ?? "")) return [];

  const rawQuestions = parseQuestions(toolPart.input);
  return rawQuestions.flatMap((raw, index) => {
    const cardPart = buildQuestionCardPart({ raw, index, toolCallId: toolPart.toolCallId });
    return cardPart ? [cardPart] : [];
  });
}

/**
 * The same cards, built from the WAIT rather than from the message part. The wait is on the
 * record from the moment the tool raises it, and the part only lands when the turn ends, so a
 * tab that adopted a running turn had nothing to render. Both paths mint the same block ids.
 */
export function questionWaitCardParts({
  toolCallId,
  questions,
}: {
  toolCallId: string | null;
  questions: unknown;
}): LangyCardPart[] {
  if (!toolCallId) return [];
  return questionToolCardParts({
    type: "tool-question",
    state: "input-available",
    toolCallId,
    input: { questions },
  });
}

/**
 * The tool calls whose question cards the rendered transcript already carries. The wait and the
 * message part are two readings of one ask, so exactly one of them draws the card.
 */
export function questionToolCallIdsIn(
  messages: readonly { parts?: readonly unknown[] }[],
): Set<string> {
  return new Set(
    messages.flatMap((message) =>
      (message.parts ?? []).flatMap((part) => {
        const toolCallId = questionToolCallIdOf(part);
        return toolCallId ? [toolCallId] : [];
      }),
    ),
  );
}

/** The tool call one `question` part names, or null when it names none. */
function questionToolCallIdOf(part: unknown): string | null {
  if (!isQuestionToolPart(part)) return null;
  const toolCallId = (part as { toolCallId?: unknown }).toolCallId;
  return typeof toolCallId === "string" && toolCallId !== "" ? toolCallId : null;
}
