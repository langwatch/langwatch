import { defineTextStyles } from "@chakra-ui/react";

const tabular = { fontVariantNumeric: "tabular-nums" } as const;

/**
 * Type scale 11 to 20px, weights 400/500/600: titles 600 except the page header title (500),
 * labels 500; prose styles carry no weight. Mono only for ids, code and durations.
 * px-to-style mapping: dev/docs/best_practices/type-scale.md.
 */
export const productTextStyles = defineTextStyles({
  pageTitle: {
    description: "The one title of a page, as the PageLayout header sets it",
    value: { fontSize: "20px", lineHeight: "28px", fontWeight: "600", letterSpacing: "-0.01em" },
  },
  pageTitleCompact: {
    description: "The page title in a compact (48px) header",
    value: { fontSize: "16px", lineHeight: "24px", fontWeight: "500", letterSpacing: "-0.01em" },
  },
  sectionTitle: {
    description: "A section heading inside a page or drawer",
    value: { fontSize: "16px", lineHeight: "24px", fontWeight: "600" },
  },
  cardTitle: {
    description: "The title of a card, panel or dialog section",
    value: { fontSize: "14px", lineHeight: "20px", fontWeight: "600" },
  },
  metric: {
    description: "A headline number: a stat tile's value, a summary figure",
    value: { fontSize: "18px", lineHeight: "24px", fontWeight: "600", ...tabular },
  },
  body: {
    description: "Running text: descriptions, paragraphs, table cells at default density",
    value: { fontSize: "14px", lineHeight: "20px" },
  },
  bodySm: {
    description: "Dense UI text: list rows, menus, card descriptions, form hints",
    value: { fontSize: "13px", lineHeight: "20px" },
  },
  label: {
    description: "A field label, a row's name, an emphasised dense line",
    value: { fontSize: "13px", lineHeight: "20px", fontWeight: "500" },
  },
  caption: {
    description: "Secondary metadata under or beside a line: timestamps, counts, hints",
    value: { fontSize: "12px", lineHeight: "16px" },
  },
  groupLabel: {
    description: "A sentence-case label over a group of items (navigation groups, menus)",
    value: { fontSize: "12px", lineHeight: "16px", fontWeight: "500" },
  },
  eyebrow: {
    description: "A small uppercase label over a group; prefer groupLabel in navigation",
    value: {
      fontSize: "11px",
      lineHeight: "16px",
      fontWeight: "500",
      letterSpacing: "0.05em",
      textTransform: "uppercase",
    },
  },
  micro: {
    description: "The smallest text: badges, counters, keyboard hints, chart ticks",
    value: { fontSize: "11px", lineHeight: "16px" },
  },
  mono: {
    description: "Ids, code and durations inline with dense text",
    value: { fontFamily: "mono", fontSize: "13px", lineHeight: "20px", ...tabular },
  },
  monoSm: {
    description: "Ids, code and durations in captions and table metadata",
    value: { fontFamily: "mono", fontSize: "12px", lineHeight: "16px", ...tabular },
  },
});

/**
 * The guided onboarding takeover: Langy's Sentient lines and the value cards, cut as the brand
 * screens were. A documented exception to the product scale above, used nowhere else.
 */
export const takeoverTextStyles = defineTextStyles({
  takeoverHello: {
    description: "Langy's greeting on the takeover's first screen",
    value: { fontFamily: "display", fontSize: "36px", lineHeight: "1.25", fontWeight: "400" },
  },
  takeoverQuestion: {
    description: "Langy's question over the takeover's value cards",
    value: { fontFamily: "display", fontSize: "30px", lineHeight: "1.25", fontWeight: "400" },
  },
  takeoverPrompt: {
    description: "Langy's line over the takeover's provider connect",
    value: { fontFamily: "display", fontSize: "24px", lineHeight: "1.375", fontWeight: "400" },
  },
  takeoverCardTitle: {
    description: "A takeover value card's title",
    value: { fontSize: "14.5px", fontWeight: "600" },
  },
  takeoverCardBody: {
    description: "A takeover value card's description",
    value: { fontSize: "12px", lineHeight: "1.6" },
  },
  takeoverBadge: {
    description: "The pick-order digit on a takeover value card",
    value: { fontSize: "10.5px", fontWeight: "600" },
  },
});

/** The scale in pixels, for surfaces that take a number (chart ticks, editor options). */
export const TYPE_SCALE_PX = {
  micro: 11,
  caption: 12,
  bodySm: 13,
  body: 14,
  sectionTitle: 16,
  metric: 18,
  pageTitle: 20,
} as const;

/** Block-glyph pixel art (the coding agents' startup marks): a glyph is one art pixel, not text. */
export const GLYPH_ART_PX = 4;

/** The icon rail's tile label: a documented exception below the scale, as the 56px rail needs. */
export const ICON_RAIL_LABEL_PX = 8.5;
