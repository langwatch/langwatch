/**
 * Block Kit allowlist v1 (see ADR-036), extended for `rich_text` in ADR-041.
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
 * elements.
 *
 * ADR-041 admits `rich_text` (the Slack composer's native output — presentational
 * and webhook-safe) so templates can render native quoted I/O / code blocks. Its
 * inline content is recursively sanitised (`sanitizeRichText`): only text-shaped
 * inline elements survive, and `broadcast` / `user` / `usergroup` / `channel`
 * mention elements are dropped — they render as @channel / <@user> pings, the
 * same notification-abuse class the mrkdwn escaper neutralises (`<!channel>`).
 * `link.url` is scheme-validated so `javascript:` / `data:` links cannot ride in.
 *
 * ADR-041 Phase 3 blocks — `table`, `data_visualization` — are DELIBERATELY
 * withheld: their incoming-webhook delivery is unverified, so they stay off the
 * allowlist (and get stripped like any unknown block) until a delivery probe
 * confirms the channel renders them. Templates that use them are registered
 * behind `deliveryProbe` and degrade to their surrounding allowlisted blocks.
 */

export const ALLOWED_BLOCK_TYPES = [
  "section",
  "divider",
  "context",
  "header",
  "markdown",
  "rich_text",
] as const;

export type AllowedBlockType = (typeof ALLOWED_BLOCK_TYPES)[number];

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

function isBlock(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedType(type: unknown): type is AllowedBlockType {
  return (
    typeof type === "string" &&
    (ALLOWED_BLOCK_TYPES as readonly string[]).includes(type)
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

/**
 * Filters arbitrary parsed Block Kit JSON down to the safe, presentational
 * allowlist. Non-array input or non-object entries yield an empty list.
 */
export function filterBlockKit(blocks: unknown): Record<string, unknown>[] {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter(isBlock)
    .filter((block) => isAllowedType(block.type))
    .map(stripInteractiveAccessory)
    .map(sanitizeContextElements)
    .map(sanitizeRichText);
}
