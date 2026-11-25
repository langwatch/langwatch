import { Text, type TextProps } from "@chakra-ui/react";

export { GLYPH_ART_PX, TYPE_SCALE_PX } from "../../system/text-styles.ts";

type TitleProps = Omit<TextProps, "fontSize" | "fontWeight" | "textStyle">;
type LineProps = Omit<TextProps, "fontSize" | "textStyle">;

/** A section heading inside a page or drawer: 16/24 semibold, an `h2` by default. */
export function SectionTitle(props: TitleProps) {
  return <Text as="h2" textStyle="sectionTitle" color="fg" {...props} />;
}

/** The title of a card or panel: 14/20 semibold, an `h3` by default. */
export function CardTitle(props: TitleProps) {
  return <Text as="h3" textStyle="cardTitle" color="fg" {...props} />;
}

/** A small label over a group. Sentence case by default; `uppercase` for the eyebrow cut. */
export function Eyebrow({ uppercase = false, ...props }: LineProps & { uppercase?: boolean }) {
  return <Text textStyle={uppercase ? "eyebrow" : "groupLabel"} color="fg.muted" {...props} />;
}

/** Secondary metadata beside or under a line: 12/16, muted. `mono` for ids and durations. */
export function MetaText({ mono = false, ...props }: LineProps & { mono?: boolean }) {
  return <Text textStyle={mono ? "monoSm" : "caption"} color="fg.muted" {...props} />;
}
