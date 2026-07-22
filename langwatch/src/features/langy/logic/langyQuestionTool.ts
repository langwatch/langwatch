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
import { parseLangyCardPart, type LangyCardPart } from "@langwatch/langy";

interface QuestionToolPartLike {
  type?: string;
  toolName?: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
}

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
  const p = part as QuestionToolPartLike;
  if (p?.type === "tool-question") return true;
  return p?.type === "dynamic-tool" && p.toolName === "question";
}

interface RawQuestionOption {
  label?: unknown;
  description?: unknown;
}

interface RawQuestion {
  question?: unknown;
  header?: unknown;
  options?: unknown;
  multiple?: unknown;
  custom?: unknown;
}

/**
 * The stamped card parts a `question` tool call renders as — one choices
 * card per question it carries. Empty when the part is not a question tool,
 * its input is still streaming, or nothing in it survives the shared
 * contract's validation (the caller then leaves the part on the raw path,
 * where a broken payload belongs).
 */
export function questionToolCardParts(part: unknown): LangyCardPart[] {
  const p = part as QuestionToolPartLike;
  if (!isQuestionToolPart(part)) return [];
  if (!COMPLETE_INPUT_STATES.has(p.state ?? "")) return [];

  const input = p.input as { questions?: unknown } | undefined;
  const rawQuestions: RawQuestion[] = Array.isArray(input?.questions)
    ? (input.questions as RawQuestion[])
    : // A single bare `{ question, options }` payload, tolerated.
      input && typeof input === "object" && "question" in input
      ? [input as RawQuestion]
      : [];

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

    const rawOptions: RawQuestionOption[] = Array.isArray(raw.options)
      ? (raw.options as RawQuestionOption[])
      : [];
    const options = rawOptions
      .filter(
        (option): option is { label: string; description?: string } =>
          typeof option?.label === "string" && option.label.trim() !== "",
      )
      .map((option, optionIndex) => ({
        id: `opt-${optionIndex + 1}`,
        label: option.label,
        ...(typeof option.description === "string" &&
        option.description.trim() !== ""
          ? { description: option.description }
          : {}),
      }));
    if (options.length === 0) return;

    // Stable across renders and rehydration: the recorded selection binds by
    // this id, so it must derive from the part's own durable identity.
    const blockId = `question:${p.toolCallId ?? question}:${index}`;
    const card = {
      kind: "choices" as const,
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
