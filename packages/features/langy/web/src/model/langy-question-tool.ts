/**
 * The `question` TOOL is the choices card (ADR-060 §6) — this module is the
 * bridge.
 *
 * The worker's agent asks the user something by calling its `question` tool:
 * the part arrives as `tool-question` (or `dynamic-tool` named `question`)
 * carrying `{ questions: [{ question, header, options: [{ label,
 * description }], multiple }] }` — and then waits. Nothing settles it from
 * the model's side, so the part sits at `input-available` forever. Rendered
 * as generic tool activity that read as a dead card stuck on "Question…"
 * (with the payload as raw JSON in developer mode) — a question the user
 * could see but never answer.
 *
 * The designed mechanism for "the decision belongs to the user" already
 * exists: the choices card, with its recorded-selection answer path. So the
 * tool part maps onto that contract — question → question, options →
 * options, `multiple` → `multiSelect` — and validates through the SAME
 * schema the relay stamps fenced blocks with (`parseLangyCardPart`), so a
 * malformed ask degrades exactly like a malformed block: it stays on the
 * honest raw-activity path instead of half-rendering.
 *
 * Pure and JSX-free: `MessageContent` renders the parts this yields through
 * the ordinary `LangyDerivedCardView` path, `langyChoicesTimeline` counts
 * them as questions so the lock state derives correctly, and
 * `LangyToolActivity` excludes the tool part from the activity spine.
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

function parseQuestions(input: unknown) {
  const list = questionListSchema.safeParse(input);
  const single = singleQuestionSchema.safeParse(input);
  const candidates = list.success ? list.data : single.success ? single.data : [];
  return candidates.flatMap((candidate) => {
    const parsed = rawQuestionSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The stamped card parts a `question` tool call renders as — one choices
 * card per question it carries. Empty when the part is not a question tool,
 * its input is still streaming, or nothing in it survives the shared
 * contract's validation (the caller then leaves the part on the raw path,
 * where a broken payload belongs).
 */
export function questionToolCardParts(part: unknown): LangyCardPart[] {
  const parsedPart = questionToolPartSchema.safeParse(part);
  if (!parsedPart.success || !isQuestionToolPart(parsedPart.data)) return [];

  const toolPart = parsedPart.data;
  if (!COMPLETE_INPUT_STATES.has(toolPart.state ?? "")) return [];

  const rawQuestions = parseQuestions(toolPart.input);

  const cards: LangyCardPart[] = [];
  rawQuestions.forEach((raw, index) => {
    // `question` is the full text; `header` is the tool's short label. The
    // card has one line, so the full text wins and the header only stands in
    // when the model sent nothing else.
    const question =
      typeof raw.question === "string" && raw.question.trim() !== ""
        ? raw.question
        : typeof raw.header === "string" && raw.header.trim() !== ""
          ? raw.header
          : null;
    if (!question) return;

    const parsedOptions = z.array(rawQuestionOptionSchema).safeParse(raw.options);
    const options = (parsedOptions.success ? parsedOptions.data : [])
      .flatMap((option) => {
        if (typeof option.label !== "string" || option.label.trim() === "") {
          return [];
        }
        return [{ label: option.label, description: option.description }];
      })
      .map((option, optionIndex) => ({
        id: `opt-${optionIndex + 1}`,
        label: option.label,
        ...(typeof option.description === "string" && option.description.trim() !== ""
          ? { description: option.description }
          : {}),
      }));
    if (options.length === 0) return;

    // Stable across renders and rehydration: the recorded selection binds by
    // this id, so it must derive from the part's own durable identity.
    const blockId = `question:${toolPart.toolCallId ?? question}:${index}`;
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
    const parsed = parseLangyCardPart({
      type: "langy-card",
      blockId,
      kind: "choices",
      provenance: "derived",
      card,
    });
    if (parsed) cards.push(parsed);
  });
  return cards;
}
