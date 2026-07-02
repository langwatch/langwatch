/**
 * Content-block classifier (ADR-033 Decision 3).
 *
 * Pure, deterministic, synchronous. Takes the parsed message arrays that flow
 * through the pipeline (Anthropic-shaped `{ role, content }` where content is a
 * string or a content-block array) and labels every block with a cost category
 * plus its character count (a lightweight proxy the caller turns into a token
 * estimate downstream).
 *
 * No clock, no randomness, no I/O — same content + same code ⇒ identical output
 * (ADR-033 "Deterministic + versioned" invariant). The per-axis block count is
 * bounded by MAX_CLASSIFIED_BLOCKS_PER_SPAN; overflow blocks aggregate into the
 * axis catch-all so category totals stay complete even when detail is truncated.
 */

import {
  type Axis,
  type Category,
  catchAllFor,
  InputCategory,
  MAX_CLASSIFIED_BLOCKS_PER_SPAN,
  MCP_TOOL_PREFIX,
  OutputCategory,
} from "./categories";
import { splitLeadingMarkers } from "./contextMarkers";

/** One classified content block. `idx` is the sequential content-part index
 * within the axis walk (input parts and output parts are counted separately),
 * in prompt order (system → tool defs → conversation). This is the same index
 * space the cache-breakpoint index addresses, so the two line up by position. */
export interface ClassifiedBlock {
  idx: number;
  category: Category;
  charCount: number;
}

export interface ClassifiedBlocks {
  input: ClassifiedBlock[];
  output: ClassifiedBlock[];
}

/** A parsed message; content is a string or an array of content blocks. */
interface Message {
  role?: unknown;
  content?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const asMessageArray = (value: unknown): Message[] => {
  if (Array.isArray(value)) return value.filter(isRecord) as Message[];
  if (isRecord(value) && Array.isArray(value.messages)) {
    return value.messages.filter(isRecord) as Message[];
  }
  return [];
};

const roleOf = (msg: Message): string =>
  typeof msg.role === "string" ? msg.role : "user";

/** Flatten a content block (or string) to its display text for char counting. */
function blockText(block: unknown): string {
  if (typeof block === "string") return block;
  if (!isRecord(block)) return "";
  const b = block;
  if (typeof b.text === "string") return b.text;
  if (typeof b.thinking === "string") return b.thinking;
  if (b.type === "tool_use") {
    const name = typeof b.name === "string" ? b.name : "";
    const input =
      b.input !== undefined && b.input !== null ? safeStringify(b.input) : "";
    return `${name}${input}`;
  }
  if (b.type === "tool_result") return contentToText(b.content);
  if (typeof b.content === "string") return b.content;
  return "";
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(blockText).filter(Boolean).join("\n");
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "";
  }
}

const toolNameFromUse = (block: Record<string, unknown>): string | null =>
  typeof block.name === "string" && block.name.length > 0 ? block.name : null;

const toolCategory = ({
  name,
  mcp,
  builtin,
}: {
  name: string | null;
  mcp: Category;
  builtin: Category;
}): Category =>
  name !== null && name.startsWith(MCP_TOOL_PREFIX) ? mcp : builtin;

/**
 * Accumulates classified blocks for one axis, enforcing the block cap: once
 * MAX_CLASSIFIED_BLOCKS_PER_SPAN detailed slots are filled, every further
 * block's char count folds into a single trailing catch-all so totals survive.
 */
class AxisAccumulator {
  private readonly blocks: ClassifiedBlock[] = [];
  private overflowChars = 0;
  private overflowed = false;

  constructor(private readonly axis: Axis) {}

  push(category: Category, charCount: number): void {
    // Reserve the final slot for the overflow aggregate.
    if (this.blocks.length >= MAX_CLASSIFIED_BLOCKS_PER_SPAN - 1) {
      this.overflowed = true;
      this.overflowChars += charCount;
      return;
    }
    // idx = sequential part index within this axis (position === array length
    // before push), matching the space the cache-breakpoint index addresses.
    this.blocks.push({ idx: this.blocks.length, category, charCount });
  }

  result(): ClassifiedBlock[] {
    if (this.overflowed) {
      this.blocks.push({
        idx: this.blocks.length,
        category: catchAllFor(this.axis),
        charCount: this.overflowChars,
      });
    }
    return this.blocks;
  }
}

/**
 * Classify the content parts of one message onto the INPUT axis.
 *
 * `fresh` marks the LAST user message — the only one whose body is the current
 * turn's `user_input`. Every earlier turn (any assistant message, any earlier
 * user message) is `prior_context`, EXCEPT `tool_result` parts, which keep their
 * tool categories regardless of position. `toolNames` maps a `tool_use` id to
 * its name so a `tool_result` can be resolved to MCP vs built-in.
 */
function classifyInputMessage({
  msg,
  fresh,
  acc,
  toolNames,
}: {
  msg: Message;
  fresh: boolean;
  acc: AxisAccumulator;
  toolNames: Map<string, string>;
}): void {
  const role = roleOf(msg);

  if (role === "system") {
    pushString({
      acc,
      category: InputCategory.SYSTEM_PROMPT,
      content: msg.content,
    });
    return;
  }

  const content = msg.content;

  if (typeof content === "string") {
    if (fresh && role === "user") pushFreshUserText(acc, content);
    else acc.push(InputCategory.PRIOR_CONTEXT, content.length);
    return;
  }

  if (!Array.isArray(content)) return;

  for (const part of content) {
    if (typeof part === "string") {
      if (fresh && role === "user") pushFreshUserText(acc, part);
      else acc.push(InputCategory.PRIOR_CONTEXT, part.length);
      continue;
    }
    if (!isRecord(part)) continue;

    // Record tool_use → name even in prior turns so later tool_results resolve.
    if (part.type === "tool_use") {
      const id = typeof part.id === "string" ? part.id : null;
      const name = toolNameFromUse(part);
      if (id && name) toolNames.set(id, name);
    }

    const category = inputPartCategory({ part, fresh, role, toolNames });
    if (part.type === "text" && fresh && role === "user") {
      pushFreshUserText(acc, blockText(part));
    } else {
      acc.push(category, blockText(part).length);
    }
  }
}

function inputPartCategory({
  part,
  fresh,
  role,
  toolNames,
}: {
  part: Record<string, unknown>;
  fresh: boolean;
  role: string;
  toolNames: Map<string, string>;
}): Category {
  const type = part.type;

  if (type === "tool_result") {
    const id = typeof part.tool_use_id === "string" ? part.tool_use_id : null;
    const name = id ? (toolNames.get(id) ?? null) : null;
    return toolCategory({
      name,
      mcp: InputCategory.TOOL_RESULT_MCP,
      builtin: InputCategory.TOOL_RESULT_BUILTIN,
    });
  }

  // Prior-turn blocks (non tool_result) collapse to prior_context.
  const priorTurn = !(fresh && role === "user");
  if (priorTurn) return InputCategory.PRIOR_CONTEXT;

  if (type === "image" || type === "image_url") return InputCategory.IMAGE;
  if (type === "file" || type === "document")
    return InputCategory.FILE_ATTACHMENT;
  // A tool_use nested in the fresh user message is malformed shape, but the
  // input axis must only carry input-axis categories — never leak an output
  // tool_call_* category here. It lands in the input catch-all.
  if (type === "tool_use") return InputCategory.OTHER_INPUT;
  if (type === "text") return InputCategory.USER_INPUT;
  return InputCategory.OTHER_INPUT;
}

/** Split leading injected-context markers off fresh user text; the markers get
 * their marker categories, the remaining body is the real user_input. */
function pushFreshUserText(acc: AxisAccumulator, text: string): void {
  const { markers, body } = splitLeadingMarkers(text);
  for (const marker of markers) acc.push(marker.category, marker.raw.length);
  if (body.length > 0) acc.push(InputCategory.USER_INPUT, body.length);
}

function pushString({
  acc,
  category,
  content,
}: {
  acc: AxisAccumulator;
  category: Category;
  content: unknown;
}): void {
  const text = typeof content === "string" ? content : contentToText(content);
  acc.push(category, text.length);
}

/** Classify one output-axis message (the assistant's current-turn reply). */
function classifyOutputMessage({
  msg,
  acc,
}: {
  msg: Message;
  acc: AxisAccumulator;
}): void {
  const content = msg.content;

  if (typeof content === "string") {
    acc.push(OutputCategory.ASSISTANT_TEXT, content.length);
    return;
  }
  if (!Array.isArray(content)) return;

  for (const part of content) {
    if (typeof part === "string") {
      acc.push(OutputCategory.ASSISTANT_TEXT, part.length);
      continue;
    }
    if (!isRecord(part)) continue;
    acc.push(outputPartCategory(part), blockText(part).length);
  }
}

function outputPartCategory(part: Record<string, unknown>): Category {
  const type = part.type;
  if (type === "text") return OutputCategory.ASSISTANT_TEXT;
  if (type === "thinking" || type === "redacted_thinking")
    return OutputCategory.THINKING;
  if (type === "tool_use") {
    return toolCategory({
      name: toolNameFromUse(part),
      mcp: OutputCategory.TOOL_CALL_MCP,
      builtin: OutputCategory.TOOL_CALL_BUILTIN,
    });
  }
  return OutputCategory.OTHER_OUTPUT;
}

/** Classify a request `tools` array (rare on our attrs) into tool-definition
 * categories by MCP-prefix on the tool name. */
function classifyToolDefinitions(tools: unknown, acc: AxisAccumulator): void {
  if (!Array.isArray(tools)) return;
  for (const tool of tools) {
    if (!isRecord(tool)) continue;
    const name = typeof tool.name === "string" ? tool.name : null;
    const category = toolCategory({
      name,
      mcp: InputCategory.MCP_TOOL_DEFINITIONS,
      builtin: InputCategory.TOOL_DEFINITIONS,
    });
    acc.push(category, safeStringify(tool).length);
  }
}

/**
 * Classify a span's message content into per-block cost categories on both axes.
 *
 * @param inputMessages  the request message array (or `{ messages: [...] }`)
 * @param outputMessages the response message array
 * @param tools          optional request `tools` definitions (prefix-classified)
 */
export function classifyBlocks({
  inputMessages,
  outputMessages,
  tools,
}: {
  inputMessages: unknown;
  outputMessages?: unknown;
  tools?: unknown;
}): ClassifiedBlocks {
  const input = new AxisAccumulator("input");
  const output = new AxisAccumulator("output");

  const messages = asMessageArray(inputMessages);
  const lastUserIdx = lastIndexOfUser(messages);
  const toolNames = new Map<string, string>();

  // Prompt order: system prefix, then tool definitions, then the conversation —
  // so the emitted input sequence matches the cacheable-prefix layout the cost
  // allocator reasons about by position. This splits out only the LEADING run of
  // system messages; a system message that appears later keeps its original
  // position in the conversation phase below.
  let firstNonSystem = 0;
  for (let i = 0; i < messages.length; i++) {
    if (roleOf(messages[i]!) !== "system") {
      firstNonSystem = i;
      break;
    }
    firstNonSystem = i + 1;
  }

  for (let i = 0; i < firstNonSystem; i++) {
    classifyInputMessage({
      msg: messages[i]!,
      fresh: i === lastUserIdx,
      acc: input,
      toolNames,
    });
  }
  classifyToolDefinitions(tools, input);
  for (let i = firstNonSystem; i < messages.length; i++) {
    classifyInputMessage({
      msg: messages[i]!,
      fresh: i === lastUserIdx,
      acc: input,
      toolNames,
    });
  }

  for (const msg of asMessageArray(outputMessages)) {
    classifyOutputMessage({ msg, acc: output });
  }

  return { input: input.result(), output: output.result() };
}

function lastIndexOfUser(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (roleOf(messages[i]!) === "user") return i;
  }
  return -1;
}
