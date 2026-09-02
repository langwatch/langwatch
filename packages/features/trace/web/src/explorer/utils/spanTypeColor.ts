import { SPAN_TYPE_COLORS } from "../../index";

/**
 * The palette read as the open map a span's `type` actually indexes. A type
 * arrives as free text from an SDK, so the read is total by construction and
 * every caller goes through {@link spanTypeColor} rather than indexing the
 * literal map, which is what keeps an unknown type from resolving to
 * `undefined` under an implicit `any`.
 */
const colorByType: Readonly<Record<string, string>> = SPAN_TYPE_COLORS;

/**
 * The Chakra colour token a span's type is drawn in.
 *
 * An unrecognised — or absent — type gets the palette's own grey, the token
 * `span` and `module` already resolve to.
 */
export function spanTypeColor(type: string | null | undefined): string {
  return colorByType[type ?? "span"] ?? SPAN_TYPE_COLORS.span;
}
