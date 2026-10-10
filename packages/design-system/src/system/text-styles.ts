import { defineTextStyles } from "@chakra-ui/react";

const tabular = { fontVariantNumeric: "tabular-nums" } as const;

/**
 * The product type scale: 11 to 20px, weights 400, 500, 600. Titles are 600, labels 500;
 * prose styles carry no weight, so a recipe's own weight survives. Mono is for ids, code and
 * durations only. px-to-style mapping: dev/docs/best_practices/type-scale.md.
 */
export const productTextStyles = defineTextStyles({
  pageTitle: {
    description: "The one title of a page, as the PageLayout header sets it",
    value: { fontSize: "20px", lineHeight: "28px", fontWeight: "600", letterSpacing: "-0.01em" },
  },
  pageTitleCompact: {
    description: "The page title in a compact (48px) header",
    value: { fontSize: "16px", lineHeight: "24px", fontWeight: "600", letterSpacing: "-0.01em" },
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
