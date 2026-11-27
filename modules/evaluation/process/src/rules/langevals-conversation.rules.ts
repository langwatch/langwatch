import { convertTo } from "@langwatch/dataset-contract";

/**
 * A mapped conversation as langevals' turns. A mapping that resolves to nothing arrives as "",
 * which `convertTo` wraps as one empty turn and langevals refuses (a 422 on every run), so empty
 * strings are dropped: an unmapped conversation is an empty list, like unmapped contexts.
 */
export function toLangevalsConversation(value: unknown): unknown[] | undefined {
  const decoded = convertTo(value, "array");
  if (decoded === undefined) return undefined;
  const turns: unknown[] = Array.isArray(decoded) ? decoded : [decoded];

  return turns.filter((turn) => !(typeof turn === "string" && turn.trim() === ""));
}
