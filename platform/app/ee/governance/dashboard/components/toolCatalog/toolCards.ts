// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AiToolTileType } from "~/components/me/tiles/types";

import type { SourceType } from "../ingestionSourceCatalog";

/**
 * The registered-tools catalog: one card per AI tool the organization has
 * registered with LangWatch, and the figures each card would carry once the
 * platform measures them.
 *
 * A CARD IS A REGISTERED TOOL, NOT A CONNECTOR. The pane used to derive a
 * "tool" from each configured ingestion source, so it listed the admin
 * connectors — the pipes that carry the data, not the things the organization
 * bought. A source is how telemetry arrives; the tool registry (`AiToolEntry`)
 * is the list of tools, and it is what this file builds from. Nothing here
 * joins the two: no source carries a tool, and inferring one from a source
 * type would put a made-up relationship on a renewal screen.
 *
 * The hard rule of this file is that a figure is either MEASURED or ABSENT. A
 * card row holds nothing until a read on this branch can fill it, and the
 * renderer draws an em dash with the name of the read that would — never a
 * plausible number. The catalog is the screen someone reads before signing a
 * renewal, so a number in the house typeface that nobody measured is the one
 * failure worth designing the type around. On this branch NO row of a real
 * card is measured: every per-tool read named below is still keyed by
 * organization or by ingestion source, so every applicable row on a real card
 * shows its dash and its sentence.
 *
 * A ROW EITHER APPLIES TO A TOOL OR IT DOES NOT, which is a separate question
 * from whether it is measured. Seats do not apply to a per-person coding
 * assistant at all — it is paid for as a subscription — so a Seats row on that
 * card would be a permanent dash promising a read that will never exist. The
 * rows a tool has are {@link ToolCard.applicableRows}; a card renders only
 * those, and the table (which has fixed columns) draws an em dash in the cells
 * a tool has no row for, saying so on hover.
 *
 * Sample mode is the exception to the measurement rule, and it is a whole
 * separate list of cards (`SAMPLE_TOOL_CARDS`) rather than a flag that fills
 * the real ones in — so no invented figure can ever land on a card built from
 * the real registry.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */

/** Every row a card can carry, in the order they are read. */
export const TOOL_CARD_ROWS = [
  "seats",
  "licencePerMonth",
  "idlePerMonth",
  "subscriptions",
  "eventsLast24Hours",
  "usage30Days",
  "attributed",
  "topDepartment",
  "agents",
  "tokens30Days",
  "conversations30Days",
] as const;

export type ToolCardRow = (typeof TOOL_CARD_ROWS)[number];

/**
 * What each row is called, and — when it is empty — what would fill it.
 *
 * `filledBy` is customer-facing copy, not an internal module name: it names
 * the thing that would have to exist, so an empty row reads as a next step
 * rather than as breakage. Words are spelled out, per the section's copy rule.
 */
export const TOOL_CARD_ROW_META: Record<
  ToolCardRow,
  { label: string; filledBy: string }
> = {
  seats: {
    label: "Seats",
    filledBy:
      "Seat counts arrive from a source that reads the vendor's licence list.",
  },
  licencePerMonth: {
    label: "Licence per month",
    filledBy: "Contract price required to calculate monthly licence cost.",
  },
  idlePerMonth: {
    label: "Unassigned licence cost",
    filledBy:
      "Assigned seat counts and contract price required to calculate monthly unassigned licence cost.",
  },
  subscriptions: {
    label: "Subscriptions",
    filledBy:
      "Subscription counts arrive from a source that reads the vendor's plan membership.",
  },
  eventsLast24Hours: {
    label: "Events · 24 hours",
    filledBy: "Events arrive once a source for this tool is delivering.",
  },
  usage30Days: {
    label: "Usage · 30 days",
    filledBy:
      "Spend is rolled up for the whole organization today, not per tool.",
  },
  attributed: {
    label: "Attributed",
    filledBy:
      "Attribution needs the People screen to have matched this tool's actors to people.",
  },
  topDepartment: {
    label: "Top department",
    filledBy:
      "Department spend is rolled up for the whole organization today, not per tool.",
  },
  agents: {
    label: "Agents",
    filledBy: "Agents are discovered from the conversations a source delivers.",
  },
  tokens30Days: {
    label: "Tokens · 30 days",
    filledBy: "Token counts arrive with a source that reports usage.",
  },
  conversations30Days: {
    label: "Conversations · 30 days",
    filledBy:
      "Conversations arrive from a source that routes them to a trace destination.",
  },
};

/**
 * A card's badges. Independent facts rather than one label, because a tool can
 * be more than one at once and a single word would have to pick.
 */
export type ToolCardBadge =
  | "seatsAndLicences"
  | "subscription"
  | "billed"
  | "metered";

export const TOOL_CARD_BADGE_LABEL: Record<ToolCardBadge, string> = {
  seatsAndLicences: "seats · licences",
  subscription: "subscription",
  billed: "billed",
  metered: "metered",
};

/** The registry tile's own mark, for a card built from a registered tool. */
export interface ToolCardTile {
  /** `AiToolEntry.iconAsset` — "preset:<kind>" or an uploaded data URL. */
  iconAsset: string | null;
  type: AiToolTileType;
}

export interface ToolCard {
  /**
   * Stable across renders, and the id the row actions act on: the
   * `AiToolEntry` id for a real card, an invented one for a sample.
   */
  id: string;
  name: string;
  /** Who makes it, as a customer says it. */
  vendor: string;
  /**
   * The ingestion-source catalog entry whose vendor mark this card wears.
   * Only the sample cards set it — a real card wears its registry tile's own
   * icon ({@link tile}) instead, since a registered tool has no source.
   */
  sourceType: SourceType | null;
  /** The registry tile's icon, for a card built from a real registry entry. */
  tile?: ToolCardTile | null;
  badges: ToolCardBadge[];
  /**
   * The rows this tool has at all, in {@link TOOL_CARD_ROWS} order. A row
   * outside this set is not drawn on the card, and is drawn as a
   * not-applicable dash in the table.
   */
  applicableRows: readonly ToolCardRow[];
  /**
   * A row absent from this map is not measured. Never zero-filled.
   *
   * A count is stored as a NUMBER and formatted at render; anything already
   * shaped for reading — money, a percentage, a department, the seat sentence
   * — is stored as the string it should show. The type is the rule: only the
   * numbers get compacted, so no formatter has to guess whether "412,900,000"
   * is a token count or a dollar figure.
   */
  values: Partial<Record<ToolCardRow, string | number>>;
  /** Whether the tool is published to the people who use it. */
  enabled?: boolean;
  /** True only on `SAMPLE_TOOL_CARDS`, so the renderer can badge them. */
  isSample?: boolean;
}

/** Whether this tool has this row at all. */
export function rowAppliesToCard(card: ToolCard, row: ToolCardRow): boolean {
  return card.applicableRows.includes(row);
}

/**
 * Why a cell is empty, in the reader's terms.
 *
 * Two different emptinesses, said differently on purpose. A row the tool does
 * not have will never fill, and saying "arrives once a source is delivering"
 * about it would promise a read nobody is going to build. A row the tool does
 * have but nothing measures yet gets the sentence naming what would fill it.
 */
export function toolCardMissingReason(
  card: ToolCard,
  row: ToolCardRow,
): string {
  if (!rowAppliesToCard(card, row)) {
    return `${TOOL_CARD_ROW_META[row].label} does not apply to ${card.name}.`;
  }
  if (card.sourceType === "copilot_studio_dataverse") {
    if (row === "tokens30Days") {
      return "Token reporting not connected. Copilot tokens require an additional telemetry source.";
    }
    if (row === "usage30Days") {
      return "Complete dollar spend requires billing data. Conversation credits alone are not a dollar total.";
    }
  }
  if (card.sourceType === "databricks_genie" && row === "tokens30Days") {
    return "Token counts are not reported by the connected Genie conversation source.";
  }
  return TOOL_CARD_ROW_META[row].filledBy;
}

/**
 * Where a count stops being read and starts being counted.
 *
 * Below a million, digit grouping is enough: "22,180" is read at a glance and
 * is exact. At and above a million the digits stop carrying meaning — nobody
 * compares 412,900,000 against 204,100,000 by their digits, they compare 413
 * against 204 and lose a second doing it. So the compact form starts there.
 *
 * Deliberately a threshold rather than a per-row choice. Token counts are the
 * row that hurts today, but a busy organization's event count reaches eight
 * digits too, and a rule tied to the row would leave that one long.
 */
const COMPACT_FROM = 1_000_000;

const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const GROUPED = new Intl.NumberFormat("en-US");

/**
 * A count as the card shows it: "412.9M" past the threshold, "22,180" below.
 *
 * Pairs with {@link exactCardCount}, which is what the reader gets on hover —
 * the compact form is never the only place a figure exists.
 */
export function formatCardCount(value: number): string {
  return Math.abs(value) >= COMPACT_FROM
    ? COMPACT.format(value)
    : GROUPED.format(value);
}

/** The same count in full, for the hover and the accessible name. */
export function exactCardCount(value: number): string {
  return GROUPED.format(value);
}

/** Two letters for a tool with no vendor mark, e.g. "OpenCode" becomes "OP". */
export function toolInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}
