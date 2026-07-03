/**
 * Content-block classifier (ADR-033 Decision 3).
 *
 * Pure, deterministic, synchronous. Takes the parsed message arrays that flow
 * through the pipeline (Anthropic-shaped `{ role, content }` where content is a
 * string or a content-block array) and labels every block with a cost category,
 * its flattened text, and that text's character count (a lightweight proxy the
 * caller turns into a per-block token estimate downstream via the tokenizer).
 *
 * No clock, no randomness, no I/O — same content + same code ⇒ identical output
 * (ADR-033 "Deterministic + versioned" invariant). The per-axis block count is
 * bounded by MAX_CLASSIFIED_BLOCKS_PER_SPAN; overflow blocks aggregate into the
 * axis catch-all so category totals stay complete even when detail is truncated.
 *
 * The walk also records the last cache_control breakpoint on the INPUT axis
 * (Anthropic marks the cacheable prefix with `cache_control` on a block). It is
 * returned as an index into the input blocks array — the same idx space the
 * cost allocator's `lastCacheBreakpointIndex` addresses — so the two line up by
 * position without a second tree walk.
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
 * space the cache-breakpoint index addresses, so the two line up by position.
 * `text` is the block's flattened content — the caller tokenizes it to turn
 * `charCount` (its length) into a real per-block token estimate. */
export interface ClassifiedBlock {
  idx: number;
  category: Category;
  charCount: number;
  text: string;
}

export interface ClassifiedBlocks {
  input: ClassifiedBlock[];
  output: ClassifiedBlock[];
  /** Index into `input` of the last cache_control breakpoint (the cached prefix
   * is blocks `0..index`), or `null` when the content carries no effective
   * breakpoint — in which case all input is treated as fresh downstream. */
  lastInputCacheBreakpointIndex: number | null;
}

/** A parsed message; content is a string or an array of content blocks. */
interface Message {
  role?: unknown;
  content?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Anthropic marks the cacheable prefix with a `cache_control` object on the
 * block (or on a system/tool-definition entry). */
const hasCacheControl = (v: unknown): boolean =>
  isRecord(v) && v.cache_control != null;

const someCacheControl = (content: unknown): boolean =>
  Array.isArray(content) && content.some(hasCacheControl);

const asMessageArray = (value: unknown): Message[] => {
  if (Array.isArray(value)) return value.filter(isRecord) as Message[];
  if (isRecord(value) && Array.isArray(value.messages)) {
    return value.messages.filter(isRecord) as Message[];
  }
  return [];
};

const roleOf = (msg: Message): string =>
  typeof msg.role === "string" ? msg.role : "user";

/** Flatten a content block (or string) to its display text for tokenizing. */
/** Depth ceiling for the blockText↔contentToText mutual recursion. A malformed
 * or adversarial deeply-nested `tool_result` (thousands of levels) would blow
 * the stack on the SYNCHRONOUS ingest path; honest content nests a handful deep.
 * Past the ceiling the walk yields empty text (the block still classifies, it
 * just contributes no token mass — the pool scaler absorbs the rest). */
const MAX_BLOCK_TEXT_DEPTH = 16;

function blockText(block: unknown, depth = 0): string {
  if (depth > MAX_BLOCK_TEXT_DEPTH) return "";
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
  if (b.type === "tool_result") return contentToText(b.content, depth + 1);
  if (typeof b.content === "string") return b.content;
  return "";
}

function contentToText(content: unknown, depth = 0): string {
  if (depth > MAX_BLOCK_TEXT_DEPTH) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => blockText(block, depth + 1))
    .filter(Boolean)
    .join("\n");
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
}): Category => (name?.startsWith(MCP_TOOL_PREFIX) ? mcp : builtin);

/**
 * Accumulates classified blocks for one axis, enforcing the block cap: once
 * MAX_CLASSIFIED_BLOCKS_PER_SPAN detailed slots are filled, every further
 * block's text folds into a single trailing catch-all so totals survive.
 * Also tracks the last block marked as a cache_control breakpoint.
 */
class AxisAccumulator {
  private readonly blocks: ClassifiedBlock[] = [];
  private readonly overflowTexts: string[] = [];
  private overflowChars = 0;
  private overflowed = false;
  private lastBreakpointIdx: number | null = null;

  constructor(private readonly axis: Axis) {}

  push(category: Category, text: string): void {
    const charCount = text.length;
    // Reserve the final slot for the overflow aggregate.
    if (this.blocks.length >= MAX_CLASSIFIED_BLOCKS_PER_SPAN - 1) {
      this.overflowed = true;
      this.overflowChars += charCount;
      this.overflowTexts.push(text);
      return;
    }
    // idx = sequential part index within this axis (position === array length
    // before push), matching the space the cache-breakpoint index addresses.
    this.blocks.push({ idx: this.blocks.length, category, charCount, text });
  }

  /** Count of detail blocks pushed so far (excludes the overflow aggregate).
   * Callers compare it across a push to tell whether a part actually appended a
   * block before marking a breakpoint on it. */
  size(): number {
    return this.blocks.length;
  }

  /** Mark the most recently pushed block as carrying a cache_control breakpoint.
   * Breakpoints live in the cacheable prefix, never in the overflow tail. */
  markBreakpoint(): void {
    if (this.overflowed) return;
    const last = this.blocks[this.blocks.length - 1];
    if (last) this.lastBreakpointIdx = last.idx;
  }

  breakpointIndex(): number | null {
    return this.lastBreakpointIdx;
  }

  result(): ClassifiedBlock[] {
    if (this.overflowed) {
      this.blocks.push({
        idx: this.blocks.length,
        category: catchAllFor(this.axis),
        charCount: this.overflowChars,
        text: this.overflowTexts.join(""),
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
    if (someCacheControl(msg.content)) acc.markBreakpoint();
    return;
  }

  const content = msg.content;

  if (typeof content === "string") {
    // A whole-message string is the leading (and only) part — peel markers.
    if (fresh && role === "user") pushFreshUserOrMarkers(acc, content, true);
    else acc.push(InputCategory.PRIOR_CONTEXT, content);
    return;
  }

  if (!Array.isArray(content)) return;

  // Injected context (system-reminder / skill / mcp-instructions markers) is
  // prepended only to the FIRST text part of the fresh user message. Peel
  // markers off that part alone; a later text part carrying a `<tag>` is real
  // user content, not injected context, so it stays whole as user_input.
  let leadingTextPending = fresh && role === "user";

  for (const part of content) {
    if (typeof part === "string") {
      if (fresh && role === "user") {
        pushFreshUserOrMarkers(acc, part, leadingTextPending);
        leadingTextPending = false;
      } else acc.push(InputCategory.PRIOR_CONTEXT, part);
      continue;
    }
    if (!isRecord(part)) continue;

    // Record tool_use → name even in prior turns so later tool_results resolve.
    // First-write-wins: a duplicate id keeps the EARLIER tool (temporal order),
    // so an earlier tool_result resolves to the tool it actually belongs to.
    if (part.type === "tool_use") {
      const id = typeof part.id === "string" ? part.id : null;
      const name = toolNameFromUse(part);
      if (id && name && !toolNames.has(id)) toolNames.set(id, name);
    }

    const before = acc.size();
    const category = inputPartCategory({ part, fresh, role, toolNames });
    if (part.type === "text" && fresh && role === "user") {
      pushFreshUserOrMarkers(acc, blockText(part), leadingTextPending);
      leadingTextPending = false;
    } else {
      acc.push(category, blockText(part));
    }
    // Mark the breakpoint only if THIS part actually appended a block — else the
    // mark lands on a prior part's block and the cached-prefix boundary is wrong.
    if (hasCacheControl(part) && acc.size() > before) acc.markBreakpoint();
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

/** Push a fresh-user text part. On the LEADING part (`peel`), split leading
 * injected-context markers off — the markers get their marker categories, the
 * remaining body is real user_input. On any later part, the whole text is
 * user_input: injected context only ever prefixes the first part, so peeling a
 * later part would mislabel a `<tag>` in real user prose as prior_context. */
function pushFreshUserOrMarkers(
  acc: AxisAccumulator,
  text: string,
  peel: boolean,
): void {
  if (!peel) {
    if (text.length > 0) acc.push(InputCategory.USER_INPUT, text);
    return;
  }
  const { markers, body } = splitLeadingMarkers(text);
  for (const marker of markers) acc.push(marker.category, marker.raw);
  if (body.length > 0) acc.push(InputCategory.USER_INPUT, body);
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
  acc.push(category, text);
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
    acc.push(OutputCategory.ASSISTANT_TEXT, content);
    return;
  }
  if (!Array.isArray(content)) return;

  for (const part of content) {
    if (typeof part === "string") {
      acc.push(OutputCategory.ASSISTANT_TEXT, part);
      continue;
    }
    if (!isRecord(part)) continue;
    acc.push(outputPartCategory(part), blockText(part));
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
    acc.push(category, safeStringify(tool));
    if (hasCacheControl(tool)) acc.markBreakpoint();
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

  return {
    input: input.result(),
    output: output.result(),
    lastInputCacheBreakpointIndex: input.breakpointIndex(),
  };
}

function lastIndexOfUser(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (roleOf(messages[i]!) === "user") return i;
  }
  return -1;
}
