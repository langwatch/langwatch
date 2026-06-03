/**
 * Block Kit allowlist v1 (see ADR-028).
 *
 * Customer-authored Block Kit can post interactive callbacks back to LangWatch.
 * We do not want to receive arbitrary customer-defined interactions, so only
 * presentational blocks survive; interactive blocks (`actions`, `input`) are
 * dropped entirely, and interactive `accessory` elements on otherwise-allowed
 * `section` blocks (buttons, selects, date pickers, …) are stripped — only an
 * `image` accessory is kept.
 */

export const ALLOWED_BLOCK_TYPES = [
  "section",
  "divider",
  "context",
  "header",
  "image",
] as const;

export type AllowedBlockType = (typeof ALLOWED_BLOCK_TYPES)[number];

const ALLOWED_ACCESSORY_TYPES = new Set(["image"]);

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

/**
 * Filters arbitrary parsed Block Kit JSON down to the safe, presentational
 * allowlist. Non-array input or non-object entries yield an empty list.
 */
export function filterBlockKit(blocks: unknown): Record<string, unknown>[] {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter(isBlock)
    .filter((block) => isAllowedType(block.type))
    .map(stripInteractiveAccessory);
}
