import { SPAN_TYPE_COLORS } from "../../../../index";

/**
 * The palette read as the open map a span's `type` actually indexes.
 */
const colorByType: Readonly<Record<string, string>> = SPAN_TYPE_COLORS;

/**
 * The Chakra colour token a span's type is drawn in.
 */
export function spanTypeColor(type: string | null | undefined): string {
  return colorByType[type ?? "span"] ?? SPAN_TYPE_COLORS.span;
}
