/**
 * Block Kit allowlist v1 (see ADR-036).
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
 */

export const ALLOWED_BLOCK_TYPES = [
  "section",
  "divider",
  "context",
  "header",
  "markdown",
] as const;

export type AllowedBlockType = (typeof ALLOWED_BLOCK_TYPES)[number];

// No accessory types are allowed — section accessories can carry image URLs
// that fire on message render (same tracking-pixel concern as image blocks).
const ALLOWED_ACCESSORY_TYPES = new Set<string>([]);

// Only text-shaped elements may live inside context blocks. mrkdwn / plain_text
// carry no fetchable URL; image / user / usergroup can.
const ALLOWED_CONTEXT_ELEMENT_TYPES = new Set<string>(["mrkdwn", "plain_text"]);

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
    .map(sanitizeContextElements);
}
