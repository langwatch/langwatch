/**
 * Block Kit allowlist v1 (ADR-036), extended for `rich_text` (ADR-041) and the
 * 2025-2026 "richer" blocks — `alert`, `card`, `data_visualization`,
 * `data_table` (ADR-041 Phase 3).
 *
 * Customer-authored Block Kit can post interactive callbacks back to LangWatch.
 * We do not want to receive arbitrary customer-defined interactions, so only
 * presentational blocks survive; interactive blocks (`actions`, `input`) are
 * dropped entirely, and interactive `accessory` elements on otherwise-allowed
 * `section` blocks (buttons, selects, date pickers, …) are stripped.
 *
 * tpl-001 / tpl-002: `image` blocks are NOT allowed (tracking-pixel vector
 * against Slack workspace recipients — mirrors the markdown sanitizer which
 * intentionally bans `<img>`). Section `accessory` images are also stripped.
 * Nested elements inside `context` blocks are filtered to text-only
 * (mrkdwn / plain_text) so the ban can't be bypassed via nested `image`
 * elements. The same rule strips image-bearing `icon` / `hero_image` from a
 * `card` and `image` cells / elements from a `data_table`.
 *
 * ADR-041 admits `rich_text` (the Slack composer's native output — presentational
 * and webhook-safe) so templates can render native quoted I/O / code blocks. Its
 * inline content is recursively sanitised (`sanitizeRichText`): only text-shaped
 * inline elements survive, and `broadcast` / `user` / `usergroup` / `channel`
 * mention elements are dropped — they render as @channel / <@user> pings, the
 * same notification-abuse class the mrkdwn escaper neutralises (`<!channel>`).
 * `link.url` is scheme-validated so `javascript:` / `data:` links cannot ride in.
 *
 * TWO-TIER GATING. `ALLOWED_BLOCK_TYPES` are verified webhook-safe and always
 * pass through. `GATED_BLOCK_TYPES` (`alert`, `card`, `data_visualization`,
 * `data_table`) have full sanitisers below but their incoming-webhook delivery
 * is UNVERIFIED — the Slack reference documents `alert` as modal-only, and does
 * not state message-surface support for `card` / `data_visualization` /
 * `data_table`. So `filterBlockKit` DROPS gated blocks by default; a template
 * built on one must carry allowlisted fallback blocks so the message still
 * delivers (graceful degradation). Once a delivery probe confirms the channel
 * renders a gated block, callers pass `{ allowGatedBlocks: true }` and the
 * sanitiser runs instead of the block being dropped. The sanitisers keep the
 * ADR-036 posture verbatim: presentational-only, no fetch-on-render vectors,
 * recursive sanitisation of nested content.
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
 * Blocks with sanitisers below but that a real incoming webhook REJECTS with
 * `400 invalid_blocks` (probed 2026-07): `alert` is documented modal-only;
 * `data_visualization` and `data_table` have no message-surface support yet.
 * `filterBlockKit` DROPS them unless `allowGatedBlocks` is set (a future
 * delivery path — e.g. the Web API — confirms rendering). Every template that
 * uses one carries an allowlisted fallback so stripping it never yields an
 * empty message.
 */
export const GATED_BLOCK_TYPES = [
  "alert",
  "data_visualization",
  "data_table",
] as const;

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
const ALLOWED_RICH_TEXT_INLINE_TYPES = new Set<string>([
  "text",
  "link",
  "emoji",
  "date",
  "color",
]);

// A text composition object (`plain_text` / `mrkdwn`). Its `text` is already
// mrkdwn_escaped by the template on user-controlled paths; here we only keep the
// shape and the two boolean flags, discarding anything else an author appended.
const ALLOWED_TEXT_OBJECT_TYPES = new Set<string>(["plain_text", "mrkdwn"]);

const ALERT_LEVELS = new Set<string>([
  "default",
  "info",
  "warning",
  "error",
  "success",
]);

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

function isBlock(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedType(type: unknown): type is AllowedBlockType {
  return (
    typeof type === "string" &&
    (ALLOWED_BLOCK_TYPES as readonly string[]).includes(type)
  );
}

function isGatedType(type: unknown): type is GatedBlockType {
  return (
    typeof type === "string" &&
    (GATED_BLOCK_TYPES as readonly string[]).includes(type)
  );
}

function stripInteractiveAccessory(
  block: Record<string, unknown>,
): Record<string, unknown> {
  if (block.type !== "section" || !isBlock(block.accessory)) {
    return block;
  }
  if (ALLOWED_ACCESSORY_TYPES.has(block.accessory.type as string)) {
    return block;
  }
  const { accessory: _stripped, ...rest } = block;
  return rest;
}

function sanitizeContextElements(
  block: Record<string, unknown>,
): Record<string, unknown> {
  if (block.type !== "context" || !Array.isArray(block.elements)) return block;
  const elements = block.elements.filter(
    (el) =>
      isBlock(el) &&
      typeof el.type === "string" &&
      ALLOWED_CONTEXT_ELEMENT_TYPES.has(el.type),
  );
  return { ...block, elements };
}

// Only http(s) links survive — blocks `javascript:` / `data:` and other exotic
// schemes from riding in on a rich_text `link` element (ADR-041).
function isSafeLinkUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function sanitizeRichTextInline(
  el: unknown,
): Record<string, unknown> | null {
  if (!isBlock(el) || typeof el.type !== "string") return null;
  if (!ALLOWED_RICH_TEXT_INLINE_TYPES.has(el.type)) return null;
  // A link whose URL is not http(s) is dropped entirely rather than rewritten.
  if (el.type === "link" && !isSafeLinkUrl(el.url)) return null;
  return el;
}

function sanitizeRichTextElement(
  el: unknown,
): Record<string, unknown> | null {
  if (!isBlock(el) || typeof el.type !== "string") return null;
  if (!ALLOWED_RICH_TEXT_ELEMENT_TYPES.has(el.type)) return null;
  // A rich_text_list's `elements` are themselves rich_text_section sub-blocks,
  // so recurse through the same element sanitiser rather than the inline one.
  if (el.type === "rich_text_list") {
    const nested = Array.isArray(el.elements)
      ? el.elements
          .map(sanitizeRichTextElement)
          .filter((x): x is Record<string, unknown> => x !== null)
      : [];
    return { ...el, elements: nested };
  }
  const inline = Array.isArray(el.elements)
    ? el.elements
        .map(sanitizeRichTextInline)
        .filter((x): x is Record<string, unknown> => x !== null)
    : [];
  return { ...el, elements: inline };
}

// Recursively sanitise a rich_text block: keep only allowed sub-block types,
// and within each keep only text-shaped inline elements (mention elements that
// ping recipients are dropped). Mirrors the context-element sanitiser but for
// the nested rich_text tree (ADR-041).
function sanitizeRichText(
  block: Record<string, unknown>,
): Record<string, unknown> {
  if (block.type !== "rich_text" || !Array.isArray(block.elements)) return block;
  const elements = block.elements
    .map(sanitizeRichTextElement)
    .filter((x): x is Record<string, unknown> => x !== null);
  return { ...block, elements };
}

function sanitizeVerifiedBlock(
  block: Record<string, unknown>,
): Record<string, unknown> | null {
  // `card` is allowlisted for delivery but still needs its own sanitiser to
  // drop fetch-on-render icons and callback actions (returns null if the card
  // has neither a title nor a body).
  if (block.type === "card") return sanitizeCard(block);
  return sanitizeRichText(
    sanitizeContextElements(stripInteractiveAccessory(block)),
  );
}

// A text composition object, trimmed to its shape + boolean flags. Anything not
// a valid `plain_text` / `mrkdwn` object with a string `text` yields null.
function sanitizeTextObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!isBlock(value)) return null;
  if (typeof value.type !== "string" || !ALLOWED_TEXT_OBJECT_TYPES.has(value.type))
    return null;
  if (typeof value.text !== "string") return null;
  const out: Record<string, unknown> = { type: value.type, text: value.text };
  if (typeof value.emoji === "boolean") out.emoji = value.emoji;
  if (typeof value.verbatim === "boolean") out.verbatim = value.verbatim;
  return out;
}

// `alert` — a coloured banner. Text-only, no fetch vectors. An out-of-range
// `level` is dropped (Slack defaults to "default"); a missing/invalid `text`
// makes the block unusable, so it is dropped entirely (→ fallback delivers).
function sanitizeAlert(
  block: Record<string, unknown>,
): Record<string, unknown> | null {
  const text = sanitizeTextObject(block.text);
  if (!text) return null;
  const out: Record<string, unknown> = { type: "alert", text };
  if (typeof block.level === "string" && ALERT_LEVELS.has(block.level))
    out.level = block.level;
  if (typeof block.block_id === "string") out.block_id = block.block_id;
  return out;
}

// `card` — an entity-summary card. `icon` / `hero_image` / `slack_icon` are
// STRIPPED (they carry fetch-on-render image URLs — the tracking-pixel vector
// `image` is banned for), and `actions` is STRIPPED (interactive callback
// vector — the exact class ADR-036 bans). Only the text fields survive; a card
// with no surviving text field is dropped (→ fallback delivers).
function sanitizeCard(
  block: Record<string, unknown>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = { type: "card" };
  let hasContent = false;
  for (const field of ["title", "subtitle", "body", "subtext"] as const) {
    const text = sanitizeTextObject(block[field]);
    if (text) {
      out[field] = text;
      if (field === "title" || field === "body") hasContent = true;
    }
  }
  if (!hasContent) return null;
  if (typeof block.block_id === "string") out.block_id = block.block_id;
  return out;
}

function toLabel(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function sanitizePieChart(
  chart: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!Array.isArray(chart.segments)) return null;
  const segments = chart.segments
    .map((seg) => {
      if (!isBlock(seg)) return null;
      const label = toLabel(seg.label);
      const value = seg.value;
      if (label === null || typeof value !== "number" || !(value > 0))
        return null;
      return { label, value };
    })
    .filter((x): x is { label: string; value: number } => x !== null)
    .slice(0, MAX_CHART_SEGMENTS);
  if (segments.length === 0) return null;
  return { type: "pie", segments };
}

function sanitizeSeriesChart(
  chart: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!Array.isArray(chart.series) || !isBlock(chart.axis_config)) return null;
  const series = chart.series
    .map((s) => {
      if (!isBlock(s) || typeof s.name !== "string" || !Array.isArray(s.data))
        return null;
      const data = s.data
        .map((point) => {
          if (!isBlock(point)) return null;
          const label = toLabel(point.label);
          if (label === null || typeof point.value !== "number") return null;
          return { label, value: point.value };
        })
        .filter((x): x is { label: string; value: number } => x !== null)
        .slice(0, MAX_CHART_POINTS);
      if (data.length === 0) return null;
      return { name: s.name, data };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, MAX_CHART_SERIES);
  if (series.length === 0) return null;

  const categories = Array.isArray(chart.axis_config.categories)
    ? chart.axis_config.categories
        .map(toLabel)
        .filter((x): x is string => x !== null)
        .slice(0, MAX_CHART_CATEGORIES)
    : [];
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
function sanitizeDataVisualization(
  block: Record<string, unknown>,
): Record<string, unknown> | null {
  if (typeof block.title !== "string") return null;
  if (!isBlock(block.chart) || typeof block.chart.type !== "string") return null;
  if (!CHART_TYPES.has(block.chart.type)) return null;
  const chart =
    block.chart.type === "pie"
      ? sanitizePieChart(block.chart)
      : sanitizeSeriesChart(block.chart);
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
    const text = typeof cell.text === "string" && cell.text.length > 0
      ? cell.text
      : toLabel(cell.value);
    if (typeof cell.value !== "number" || text === null) return placeholder;
    return { type: "raw_number", value: cell.value, text };
  }
  if (cell.type === "rich_text") {
    return sanitizeRichText(cell);
  }
  return placeholder;
}

// `data_table` — a scannable grid. Rows are capped, columns are normalised to
// the header width (short rows padded, long rows truncated) so Slack's
// equal-width-rows rule holds, `rich_text` cells are recursively sanitised, and
// the aggregate character budget is enforced. A table without at least a header
// and one data row is dropped (→ fallback delivers).
function sanitizeDataTable(
  block: Record<string, unknown>,
): Record<string, unknown> | null {
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
  if (
    typeof block.page_size === "number" &&
    block.page_size >= 1 &&
    block.page_size <= 100
  )
    out.page_size = Math.floor(block.page_size);
  if (
    typeof block.row_header_column_index === "number" &&
    block.row_header_column_index >= 0 &&
    block.row_header_column_index < columns
  )
    out.row_header_column_index = Math.floor(block.row_header_column_index);
  return out;
}

function sanitizeGatedBlock(
  block: Record<string, unknown>,
): Record<string, unknown> | null {
  switch (block.type) {
    case "alert":
      return sanitizeAlert(block);
    case "data_visualization":
      return sanitizeDataVisualization(block);
    case "data_table":
      return sanitizeDataTable(block);
    default:
      return null;
  }
}

/**
 * Filters arbitrary parsed Block Kit JSON down to the safe, presentational
 * allowlist. Non-array input or non-object entries yield an empty list.
 *
 * Gated blocks (`alert`, `data_visualization`, `data_table`) are DROPPED unless
 * `allowGatedBlocks` is set — a delivery path that renders them is confirmed.
 * When allowed, each is run through its defensive sanitiser (callback actions
 * stripped, nested cells recursively sanitised, sizes capped). `card` is
 * delivery-verified and lives in the allowed tier, sanitised in-line.
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
      const sanitized = sanitizeVerifiedBlock(block);
      if (sanitized) out.push(sanitized);
    } else if (allowGatedBlocks && isGatedType(block.type)) {
      const sanitized = sanitizeGatedBlock(block);
      if (sanitized) out.push(sanitized);
    }
  }
  return out;
}
