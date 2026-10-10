/**
 * Sanitises customer-authored Block Kit to presentational, webhook-safe
 * blocks: interactive callbacks, images, mentions, and unsafe link schemes
 * are removed; gated types stay off until their delivery path is verified.
 */

export const ALLOWED_BLOCK_TYPES = [
  "section",
  "divider",
  "context",
  "header",
  "markdown",
  "rich_text",
  // `card` is delivery-verified: a 2026-07 live probe against a real Slack
  // incoming webhook returned `200 ok` for a card block (while alert / chart /
  // table all returned `400 invalid_blocks`). It renders on the message
  // surface, so it passes through — still run through `sanitizeCard` below to
  // strip fetch-on-render icons and callback actions (ADR-036).
  "card",
] as const;

export type AllowedBlockType = (typeof ALLOWED_BLOCK_TYPES)[number];

/**
 * Blocks rejected by incoming webhooks; dropped by filterBlockKit unless
 * allowGatedBlocks is set.
 */
export const GATED_BLOCK_TYPES = ["alert", "data_visualization", "data_table"] as const;

export type GatedBlockType = (typeof GATED_BLOCK_TYPES)[number];

// No accessory types are allowed — section accessories can carry image URLs
// that fire on message render (same tracking-pixel concern as image blocks).
const ALLOWED_ACCESSORY_TYPES = new Set<string>([]);

// Only text-shaped elements may live inside context blocks. mrkdwn / plain_text
// carry no fetchable URL; image / user / usergroup can.
const ALLOWED_CONTEXT_ELEMENT_TYPES = new Set<string>(["mrkdwn", "plain_text"]);

// The sub-block types a `rich_text` block may contain. Each carries its own
// `elements` array of inline elements (a list nests further sections).
const ALLOWED_RICH_TEXT_ELEMENT_TYPES = new Set<string>([
  "rich_text_section",
  "rich_text_list",
  "rich_text_quote",
  "rich_text_preformatted",
]);

// Inline elements permitted inside a rich_text sub-block. `broadcast`, `user`,
// `usergroup`, and `channel` are deliberately EXCLUDED: they render as
// @channel / @here / <@user> pings — the same notification-abuse class as the
// `<!channel>` mrkdwn the escaper neutralises. `text` is a plain string (no
// mrkdwn parsing), so nothing user-controlled can forge markup here.
const ALLOWED_RICH_TEXT_INLINE_TYPES = new Set<string>(["text", "link", "emoji", "date", "color"]);

// A text composition object (`plain_text` / `mrkdwn`). Its `text` is already
// mrkdwn_escaped by the template on user-controlled paths; here we only keep the
// shape and the two boolean flags, discarding anything else an author appended.
const ALLOWED_TEXT_OBJECT_TYPES = new Set<string>(["plain_text", "mrkdwn"]);

const ALERT_LEVELS = new Set<string>(["default", "info", "warning", "error", "success"]);

const CHART_TYPES = new Set<string>(["pie", "area", "bar", "line"]);

// Slack's documented caps, enforced defensively so a hostile template can't
// balloon a payload past what the surface accepts.
const MAX_CHART_SERIES = 12;
const MAX_CHART_SEGMENTS = 12;
const MAX_CHART_POINTS = 20;
const MAX_CHART_CATEGORIES = 20;
const MAX_TABLE_ROWS = 30;
const MAX_TABLE_COLUMNS = 20;
const MAX_TABLE_CHARS = 10_000;

/**
 * Slack rejects entire messages on invalid_blocks (non-retryable); limits are enforced
 * here to degrade gracefully rather than fail silently.
 */
export const MAX_SECTION_TEXT_CHARS = 3000;
const MAX_SECTION_FIELDS = 10;
const MAX_SECTION_FIELD_CHARS = 2000;
const MAX_CONTEXT_ELEMENTS = 10;

// Slack's documented maxima for the two raw-ish blocks. A `markdown` block's
// `text` is a plain string (Slack rejects the whole message past 12000 chars); a
// `header` block's plain_text caps at 150. Enforced defensively so a hostile
// template can't trip `invalid_blocks` (not retryable — it loses the whole
// notification rather than degrading).
export const MAX_MARKDOWN_TEXT_CHARS = 12_000;
export const MAX_HEADER_TEXT_CHARS = 150;

/** Appended to any text this module cuts, so the reader knows the block is
 *  showing part of the content rather than all of it. */
const TRUNCATION_MARKER = "\n…(truncated)";

function isBlock(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedType(type: unknown): type is AllowedBlockType {
  return typeof type === "string" && (ALLOWED_BLOCK_TYPES as readonly string[]).includes(type);
}

function isGatedType(type: unknown): type is GatedBlockType {
  return typeof type === "string" && (GATED_BLOCK_TYPES as readonly string[]).includes(type);
}

function stripInteractiveAccessory(block: Record<string, unknown>): Record<string, unknown> {
  if (!isBlock(block.accessory)) return block;
  if (ALLOWED_ACCESSORY_TYPES.has(block.accessory.type as string)) return block;
  const { accessory: _stripped, ...rest } = block;
  return rest;
}

/** Cut `text` to `max` characters, ending on the truncation marker so the
 *  reader can tell the block is partial. */
function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

function findCappedTextObject(value: unknown, max: number): Record<string, unknown> | null {
  const text = findSanitizedTextObject(value);
  if (!text) return null;
  return { ...text, text: capText(text.text as string, max) };
}

/**
 * `section` -- the workhorse block: interactive accessories are stripped
 * (ADR-036) and text/fields capped to Slack's maxima, so overflow degrades
 * to a cut section, not a rejected message; an empty one is dropped.
 */
function findSanitizedSection(block: Record<string, unknown>): Record<string, unknown> | null {
  const out = stripInteractiveAccessory(block);
  const text = findCappedTextObject(out.text, MAX_SECTION_TEXT_CHARS);
  const fields = Array.isArray(out.fields)
    ? out.fields
        .map((field) => findCappedTextObject(field, MAX_SECTION_FIELD_CHARS))
        .filter((x): x is Record<string, unknown> => x !== null)
        .slice(0, MAX_SECTION_FIELDS)
    : [];
  if (!text && fields.length === 0) return null;
  const sanitized: Record<string, unknown> = { ...out };
  if (text) sanitized.text = text;
  else delete sanitized.text;
  if (fields.length > 0) sanitized.fields = fields;
  else delete sanitized.fields;
  return sanitized;
}

/**
 * `context` -- text-only footnotes. Slack rejects an empty `elements`
 * array with `invalid_blocks`, so a block whose every element was
 * filtered out is DROPPED rather than emitted empty.
 */
function findSanitizedContext(block: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(block.elements)) return null;
  const elements = block.elements
    .filter(
      (el) =>
        isBlock(el) && typeof el.type === "string" && ALLOWED_CONTEXT_ELEMENT_TYPES.has(el.type),
    )
    .slice(0, MAX_CONTEXT_ELEMENTS);
  if (elements.length === 0) return null;
  return { ...block, elements };
}

// Only http(s) links survive — blocks `javascript:` / `data:` and other exotic
// schemes from riding in on a rich_text `link` element (ADR-041).
function isSafeLinkUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function findSanitizedRichTextInline(el: unknown): Record<string, unknown> | null {
  if (!isBlock(el) || typeof el.type !== "string") return null;
  if (!ALLOWED_RICH_TEXT_INLINE_TYPES.has(el.type)) return null;
  // A link whose URL is not http(s) is dropped entirely rather than rewritten.
  if (el.type === "link" && !isSafeLinkUrl(el.url)) return null;
  return el;
}

// Every rich_text sub-block carries its own `elements` array, and Slack rejects
// one that is empty — so a sub-block whose every child was filtered out (a
// section holding only a mention, say) is DROPPED, not emitted empty.
function findSanitizedRichTextElement(el: unknown): Record<string, unknown> | null {
  if (!isBlock(el) || typeof el.type !== "string") return null;
  if (!ALLOWED_RICH_TEXT_ELEMENT_TYPES.has(el.type)) return null;
  if (!Array.isArray(el.elements)) return null;
  // A rich_text_list's `elements` are themselves rich_text_section sub-blocks,
  // so recurse through the same element sanitiser rather than the inline one.
  const elements =
    el.type === "rich_text_list"
      ? el.elements
          .map(findSanitizedRichTextElement)
          .filter((x): x is Record<string, unknown> => x !== null)
      : el.elements
          .map(findSanitizedRichTextInline)
          .filter((x): x is Record<string, unknown> => x !== null);
  if (elements.length === 0) return null;
  return { ...el, elements };
}

// Recursively sanitise a rich_text block: keep only allowed sub-block
// types and text-shaped inline elements (mentions are dropped). Mirrors
// the context sanitiser for the nested tree (ADR-041): an empty result is
// dropped so Slack never sees an empty `elements` array (`invalid_blocks`
// fails the whole message).
function findSanitizedRichText(block: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(block.elements)) return null;
  const elements = block.elements
    .map(findSanitizedRichTextElement)
    .filter((x): x is Record<string, unknown> => x !== null);
  if (elements.length === 0) return null;
  return { ...block, elements };
}

// Slack treats `&`, `<`, `>` as control chars that open mrkdwn links and
// broadcasts (`<!channel>`). Mirrors the `mrkdwn_escape` template filter
// (engine.ts): a `markdown` block's `text` is raw, Slack-parsed, and NOT
// template-escaped, so this is what stops attacker-controlled trace
// content forging a broadcast ping or link.
function escapeMrkdwnControlChars(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Raw markdown block; text is escaped to prevent injection, then capped to
 * Slack's maximum; blocks without string text are dropped.
 */
function findSanitizedMarkdown(block: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof block.text !== "string" || block.text.length === 0) return null;
  const text = capText(escapeMrkdwnControlChars(block.text), MAX_MARKDOWN_TEXT_CHARS);
  const out: Record<string, unknown> = { type: "markdown", text };
  if (typeof block.block_id === "string") out.block_id = block.block_id;
  return out;
}

/**
 * `header` -- a bold banner. Slack accepts ONLY `plain_text` here (no
 * mrkdwn, so no broadcast/link vector) and rejects text past 150 chars, so
 * a `mrkdwn`-typed header is coerced to `plain_text` and capped; empty is dropped.
 */
function findSanitizedHeader(block: Record<string, unknown>): Record<string, unknown> | null {
  const parsed = findSanitizedTextObject(block.text);
  if (!parsed) return null;
  // Header text is a single-line plain_text field — the multi-line truncation
  // marker would itself make Slack reject the block as invalid_blocks.
  const capped = capText(parsed.text as string, MAX_HEADER_TEXT_CHARS).replace(/\n/g, " ");
  if (capped.length === 0) return null;
  const textObject: Record<string, unknown> = {
    type: "plain_text",
    text: capped,
  };
  if (typeof parsed.emoji === "boolean") textObject.emoji = parsed.emoji;
  const out: Record<string, unknown> = { type: "header", text: textObject };
  if (typeof block.block_id === "string") out.block_id = block.block_id;
  return out;
}

function findSanitizedVerifiedBlock(
  block: Record<string, unknown>,
): Record<string, unknown> | null {
  switch (block.type) {
    // `card` is allowlisted for delivery but still needs its own sanitiser to
    // drop fetch-on-render icons and callback actions (returns null if the card
    // has neither a title nor a body).
    case "card":
      return findSanitizedCard(block);
    case "section":
      return findSanitizedSection(block);
    case "context":
      return findSanitizedContext(block);
    case "rich_text":
      return findSanitizedRichText(block);
    case "markdown":
      return findSanitizedMarkdown(block);
    case "header":
      return findSanitizedHeader(block);
    // `divider` is the only remaining allowlisted type — it carries no content,
    // so it passes through unchanged.
    default:
      return block;
  }
}

// A text composition object, trimmed to its shape + boolean flags. Anything not
// a valid `plain_text` / `mrkdwn` object with a string `text` yields null.
function findSanitizedTextObject(value: unknown): Record<string, unknown> | null {
  if (!isBlock(value)) return null;
  if (typeof value.type !== "string" || !ALLOWED_TEXT_OBJECT_TYPES.has(value.type)) return null;
  if (typeof value.text !== "string") return null;
  const out: Record<string, unknown> = { type: value.type, text: value.text };
  if (typeof value.emoji === "boolean") out.emoji = value.emoji;
  if (typeof value.verbatim === "boolean") out.verbatim = value.verbatim;
  return out;
}

// `alert` — a coloured banner. Text-only, no fetch vectors. An out-of-range
// `level` is dropped (Slack defaults to "default"); a missing/invalid `text`
// makes the block unusable, so it is dropped entirely (→ fallback delivers).
function findSanitizedAlert(block: Record<string, unknown>): Record<string, unknown> | null {
  const text = findSanitizedTextObject(block.text);
  if (!text) return null;
  const out: Record<string, unknown> = { type: "alert", text };
  if (typeof block.level === "string" && ALERT_LEVELS.has(block.level)) out.level = block.level;
  if (typeof block.block_id === "string") out.block_id = block.block_id;
  return out;
}

// `card` — an entity-summary card. `icon` / `hero_image` / `slack_icon` are
// STRIPPED (they carry fetch-on-render image URLs — the tracking-pixel vector
// `image` is banned for), and `actions` is STRIPPED (interactive callback
// vector — the exact class ADR-036 bans). Only the text fields survive; a card
// with no surviving text field is dropped (→ fallback delivers).
function findSanitizedCard(block: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = { type: "card" };
  let hasContent = false;
  for (const field of ["title", "subtitle", "body", "subtext"] as const) {
    const text = findSanitizedTextObject(block[field]);
    if (text) {
      out[field] = text;
      if (field === "title" || field === "body") hasContent = true;
    }
  }
  if (!hasContent) return null;
  if (typeof block.block_id === "string") out.block_id = block.block_id;
  return out;
}

function findLabel(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function findSanitizedPieChart(chart: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(chart.segments)) return null;
  const segments = chart.segments
    .map((seg) => {
      if (!isBlock(seg)) return null;
      const label = findLabel(seg.label);
      const value = seg.value;
      if (label === null || typeof value !== "number" || !(value > 0)) return null;
      return { label, value };
    })
    .filter((x): x is { label: string; value: number } => x !== null)
    .slice(0, MAX_CHART_SEGMENTS);
  if (segments.length === 0) return null;
  return { type: "pie", segments };
}

function sanitizeChartPoints(points: unknown[]): { label: string; value: number }[] {
  return points
    .map((point) => {
      if (!isBlock(point)) return null;
      const label = findLabel(point.label);
      if (label === null || typeof point.value !== "number") return null;
      return { label, value: point.value };
    })
    .filter((x): x is { label: string; value: number } => x !== null)
    .slice(0, MAX_CHART_POINTS);
}

function sanitizeChartCategories(categories: unknown): string[] {
  if (!Array.isArray(categories)) return [];
  return categories
    .map(findLabel)
    .filter((x): x is string => x !== null)
    .slice(0, MAX_CHART_CATEGORIES);
}

function findSanitizedSeriesChart(chart: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(chart.series) || !isBlock(chart.axis_config)) return null;
  const series = chart.series
    .map((s) => {
      if (!isBlock(s) || typeof s.name !== "string" || !Array.isArray(s.data)) return null;
      const data = sanitizeChartPoints(s.data);
      if (data.length === 0) return null;
      return { name: s.name, data };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, MAX_CHART_SERIES);
  if (series.length === 0) return null;

  const categories = sanitizeChartCategories(chart.axis_config.categories);
  if (categories.length === 0) return null;
  const axis_config: Record<string, unknown> = { categories };
  if (typeof chart.axis_config.x_label === "string")
    axis_config.x_label = chart.axis_config.x_label;
  if (typeof chart.axis_config.y_label === "string")
    axis_config.y_label = chart.axis_config.y_label;

  return { type: chart.type, series, axis_config };
}

// `data_visualization` — a native pie/bar/area/line chart. No fetchable URL
// (unlike `image`), so the risk is payload shape only: labels are coerced to
// strings and series / segments / points / categories are capped at Slack's
// documented maxima. A chart that can't produce a valid `chart` payload is
// dropped (→ fallback delivers).
function findSanitizedDataVisualization(
  block: Record<string, unknown>,
): Record<string, unknown> | null {
  if (typeof block.title !== "string") return null;
  if (!isBlock(block.chart) || typeof block.chart.type !== "string") return null;
  if (!CHART_TYPES.has(block.chart.type)) return null;
  const chart =
    block.chart.type === "pie"
      ? findSanitizedPieChart(block.chart)
      : findSanitizedSeriesChart(block.chart);
  if (!chart) return null;
  const out: Record<string, unknown> = {
    type: "data_visualization",
    title: block.title,
    chart,
  };
  if (typeof block.block_id === "string") out.block_id = block.block_id;
  return out;
}

// A single data_table cell. `raw_text` / `raw_number` are coerced to their
// documented shape; a `rich_text` cell reuses the block sanitiser (so image /
// mention elements are stripped). Anything else becomes a placeholder cell so
// the row keeps its column count (Slack requires equal-width rows).
function sanitizeTableCell(cell: unknown): Record<string, unknown> {
  const placeholder = { type: "raw_text", text: "—" };
  if (!isBlock(cell) || typeof cell.type !== "string") return placeholder;
  if (cell.type === "raw_text") {
    return typeof cell.text === "string" && cell.text.length > 0
      ? { type: "raw_text", text: cell.text }
      : placeholder;
  }
  if (cell.type === "raw_number") {
    const text =
      typeof cell.text === "string" && cell.text.length > 0 ? cell.text : findLabel(cell.value);
    if (typeof cell.value !== "number" || text === null) return placeholder;
    return { type: "raw_number", value: cell.value, text };
  }
  if (cell.type === "rich_text") {
    // A cell whose content was entirely stripped (only an image / a mention)
    // becomes the placeholder — the row must keep its column count.
    return findSanitizedRichText(cell) ?? placeholder;
  }
  return placeholder;
}

// `data_table` — a scannable grid. Rows are capped, columns are normalised to
// the header width (short rows padded, long rows truncated) so Slack's
// equal-width-rows rule holds, `rich_text` cells are recursively sanitised, and
// the aggregate character budget is enforced. A table without at least a header
// and one data row is dropped (→ fallback delivers).
function findSanitizedDataTable(block: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof block.caption !== "string") return null;
  if (!Array.isArray(block.rows) || block.rows.length < 2) return null;
  const rawRows = block.rows.filter(Array.isArray).slice(0, MAX_TABLE_ROWS);
  const header = rawRows[0];
  if (!header || header.length === 0) return null;
  const columns = Math.min(header.length, MAX_TABLE_COLUMNS);

  const rows = rawRows.map((row) => {
    const cells: Record<string, unknown>[] = [];
    for (let c = 0; c < columns; c++) {
      cells.push(sanitizeTableCell(row[c]));
    }
    return cells;
  });
  if (rows.length < 2) return null;

  const totalChars = JSON.stringify(rows).length;
  if (totalChars > MAX_TABLE_CHARS) return null;

  const out: Record<string, unknown> = {
    type: "data_table",
    caption: block.caption,
    rows,
  };
  if (typeof block.block_id === "string") out.block_id = block.block_id;
  if (typeof block.page_size === "number" && block.page_size >= 1 && block.page_size <= 100)
    out.page_size = Math.floor(block.page_size);
  if (
    typeof block.row_header_column_index === "number" &&
    block.row_header_column_index >= 0 &&
    block.row_header_column_index < columns
  )
    out.row_header_column_index = Math.floor(block.row_header_column_index);
  return out;
}

function findSanitizedGatedBlock(block: Record<string, unknown>): Record<string, unknown> | null {
  switch (block.type) {
    case "alert":
      return findSanitizedAlert(block);
    case "data_visualization":
      return findSanitizedDataVisualization(block);
    case "data_table":
      return findSanitizedDataTable(block);
    default:
      return null;
  }
}

/**
 * Filters Block Kit JSON to the safe allowlist; gated blocks are dropped unless
 * allowGatedBlocks is set; sanitisers reject invalid blocks to prevent message loss.
 */
export function filterBlockKit(
  blocks: unknown,
  { allowGatedBlocks = false }: { allowGatedBlocks?: boolean } = {},
): Record<string, unknown>[] {
  if (!Array.isArray(blocks)) return [];
  const out: Record<string, unknown>[] = [];
  for (const block of blocks) {
    if (!isBlock(block)) continue;
    if (isAllowedType(block.type)) {
      const sanitized = findSanitizedVerifiedBlock(block);
      if (sanitized) out.push(sanitized);
    } else if (allowGatedBlocks && isGatedType(block.type)) {
      const sanitized = findSanitizedGatedBlock(block);
      if (sanitized) out.push(sanitized);
    }
  }
  return out;
}
