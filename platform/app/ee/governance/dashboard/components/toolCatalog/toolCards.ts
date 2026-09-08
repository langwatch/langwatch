// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  modeForSourceType,
  SOURCE_TYPE_LABEL,
  SOURCE_TYPE_OPTIONS,
  type SourceType,
} from "../ingestionSourceCatalog";

/**
 * The registered-tools catalog: one card per AI tool the organization has told
 * LangWatch about, and the figures each card would carry once the platform
 * measures them.
 *
 * The hard rule of this file is that a figure is either MEASURED or ABSENT. A
 * card row holds nothing until a read on this branch can fill it, and the
 * renderer draws an em dash with the name of the read that would — never a
 * plausible number. The catalog is the screen someone reads before signing a
 * renewal, so a number in the house typeface that nobody measured is the one
 * failure worth designing the type around.
 *
 * Sample mode is the exception, and it is a whole separate list of cards
 * (`SAMPLE_TOOL_CARDS`) rather than a flag that fills the real ones in — so no
 * invented figure can ever land on a card built from a real source.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */

/** The rows every card carries, in the order they are read. */
export const TOOL_CARD_ROWS = [
  "seats",
  "licencePerMonth",
  "idlePerMonth",
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
    filledBy:
      "What a seat costs is not read from any provider. It comes off the contract, which nothing here holds yet.",
  },
  idlePerMonth: {
    label: "Idle per month",
    filledBy:
      "Idle spend is bought seats minus assigned ones at the contract price, so it needs both the licence list and that price.",
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
export type ToolCardBadge = "seatsAndLicences" | "billed" | "metered";

export const TOOL_CARD_BADGE_LABEL: Record<ToolCardBadge, string> = {
  seatsAndLicences: "seats · licences",
  billed: "billed",
  metered: "metered",
};

export interface ToolCard {
  /** Stable across renders; the ingestion source id for a real card. */
  id: string;
  name: string;
  /** Who makes it, as a customer says it. */
  vendor: string;
  /**
   * The catalog entry whose vendor mark this card wears, or null for a tool
   * with no source type of its own — the card then falls back to initials.
   */
  sourceType: SourceType | null;
  badges: ToolCardBadge[];
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
  /** True only on `SAMPLE_TOOL_CARDS`, so the renderer can badge them. */
  sample?: boolean;
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

/** Two letters for a tool with no vendor mark, e.g. "Cursor" becomes "CU". */
export function toolInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}

/**
 * The shape of an ingestion source this module needs — a structural subset of
 * the router's DTO, so the catalog neither imports the server module nor
 * breaks each time an unrelated field on it moves.
 */
export interface ToolCardSource {
  id: string;
  name: string;
  /**
   * The router sends this as a plain string, and a row written before a type
   * was retired can still hold one the catalog no longer offers. Narrowed with
   * {@link asSourceType} rather than cast, so an unrecognised value costs the
   * card its vendor mark instead of crashing the pane.
   */
  sourceType: string;
  parserConfig?: Record<string, unknown> | null;
}

/** The catalog's own type for this string, or null when it lists no such type. */
export function asSourceType(value: string): SourceType | null {
  return SOURCE_TYPE_OPTIONS.some((option) => option.value === value)
    ? (value as SourceType)
    : null;
}

/** Per-source volume, as `activityMonitor.ingestionSourcesHealth` reports it. */
export interface ToolCardHealth {
  id: string;
  eventsLast24h: number;
}

/**
 * Whether this source is configured to read the vendor's licence list.
 *
 * Read off `parserConfig` because that is the only place the answer exists on
 * the wire. Absent means the source type has no licence read at all, which is
 * a different statement from "switched off" — and is why the badge is simply
 * not shown rather than shown struck through.
 */
export function readsSeatLicences(source: ToolCardSource): boolean {
  return source.parserConfig?.readSeats === true;
}

/**
 * The badges a real source earns.
 *
 * A pulled or S3 source reads what the provider billed, so it is `billed`; a
 * pushed source is metered as the traffic is served. Neither claims a figure —
 * the badge says where a figure WOULD come from, which is what a reader
 * looking at an empty Usage row needs to know.
 */
export function badgesForSource(source: ToolCardSource): ToolCardBadge[] {
  const sourceType = asSourceType(source.sourceType);
  const badges: ToolCardBadge[] = [];
  if (readsSeatLicences(source)) badges.push("seatsAndLicences");
  badges.push(
    sourceType && modeForSourceType({ sourceType }) === "push"
      ? "metered"
      : "billed",
  );
  return badges;
}

/**
 * The real cards: one per configured ingestion source.
 *
 * A source IS how a tool enters the system today, so the source list is the
 * registered-tools list — there is no second registry to reconcile it with,
 * and adding a tool is adding a source. The only row this branch can fill is
 * the 24-hour event count; every other read is keyed by organization rather
 * than by tool, so those rows stay absent and say so.
 *
 * `health` is optional because the volume read is permissioned separately from
 * the source list: a viewer who may see the catalog but not the activity
 * monitor gets cards with one more empty row rather than no cards.
 */
export function buildToolCards({
  sources,
  health,
}: {
  sources: readonly ToolCardSource[];
  health?: readonly ToolCardHealth[] | null;
}): ToolCard[] {
  const eventsById = new Map(
    (health ?? []).map((row) => [row.id, row.eventsLast24h]),
  );
  return sources.map((source) => {
    const events = eventsById.get(source.id);
    const sourceType = asSourceType(source.sourceType);
    return {
      id: source.id,
      name: source.name,
      vendor: sourceType ? SOURCE_TYPE_LABEL[sourceType] : source.sourceType,
      sourceType,
      badges: badgesForSource(source),
      // The count goes in raw; the card formats it, so a real row and a
      // sample row cannot end up shaped differently.
      values: events === undefined ? {} : { eventsLast24Hours: events },
    };
  });
}

/**
 * The eight tools the sample catalog shows, with every row filled in.
 *
 * This is the screen an organization gets once the measurements behind the
 * rows exist, and it is what makes the empty rows on a real card readable as a
 * roadmap rather than as damage. Every figure here is invented, which is why
 * they live in their own list under their own badge and never merge with a
 * real card. The two consumption-billed tools carry a seat sentence rather
 * than a count, because "0 of 0" would read as a tool nobody uses.
 */
export const SAMPLE_TOOL_CARDS: ToolCard[] = [
  {
    id: "sample-claude-code",
    name: "Claude Code",
    vendor: "Anthropic",
    sourceType: "claude_code",
    badges: ["seatsAndLicences", "metered"],
    values: {
      seats: "44 of 60 active",
      licencePerMonth: "$1,140",
      idlePerMonth: "$304",
      eventsLast24Hours: 8412,
      usage30Days: "$3,268",
      attributed: "91%",
      topDepartment: "Engineering",
      agents: 12,
      tokens30Days: 412900000,
      conversations30Days: 6140,
    },
    sample: true,
  },
  {
    id: "sample-claude-cowork",
    name: "Claude Cowork",
    vendor: "Anthropic",
    sourceType: "claude_cowork",
    badges: ["seatsAndLicences", "metered"],
    values: {
      seats: "28 of 40 active",
      licencePerMonth: "$1,000",
      idlePerMonth: "$300",
      eventsLast24Hours: 1904,
      usage30Days: "$820",
      attributed: "78%",
      topDepartment: "Operations",
      agents: 4,
      tokens30Days: 58300000,
      conversations30Days: 2210,
    },
    sample: true,
  },
  {
    id: "sample-copilot-studio",
    name: "Copilot Studio",
    vendor: "Microsoft",
    sourceType: "copilot_studio_dataverse",
    badges: ["seatsAndLicences", "billed"],
    values: {
      seats: "120 of 200 active",
      licencePerMonth: "$4,000",
      idlePerMonth: "$1,600",
      eventsLast24Hours: 5310,
      usage30Days: "$2,140",
      attributed: "84%",
      topDepartment: "Customer Support",
      agents: 31,
      tokens30Days: 96400000,
      conversations30Days: 18720,
    },
    sample: true,
  },
  {
    id: "sample-github-copilot",
    name: "GitHub Copilot",
    vendor: "GitHub",
    sourceType: null,
    badges: ["seatsAndLicences", "billed"],
    values: {
      seats: "310 of 340 active",
      licencePerMonth: "$6,460",
      idlePerMonth: "$570",
      eventsLast24Hours: 22180,
      usage30Days: "$6,460",
      attributed: "96%",
      topDepartment: "Engineering",
      agents: 1,
      tokens30Days: 163500000,
      conversations30Days: 41900,
    },
    sample: true,
  },
  {
    id: "sample-chatgpt-enterprise",
    name: "ChatGPT Enterprise",
    vendor: "OpenAI",
    sourceType: "openai_compliance",
    badges: ["seatsAndLicences", "billed"],
    values: {
      seats: "180 of 250 active",
      licencePerMonth: "$15,000",
      idlePerMonth: "$4,200",
      eventsLast24Hours: 14060,
      usage30Days: "$15,000",
      attributed: "88%",
      topDepartment: "Marketing",
      agents: 9,
      tokens30Days: 204100000,
      conversations30Days: 31450,
    },
    sample: true,
  },
  {
    id: "sample-cursor",
    name: "Cursor",
    vendor: "Anysphere",
    sourceType: null,
    badges: ["seatsAndLicences", "billed"],
    values: {
      seats: "62 of 75 active",
      licencePerMonth: "$1,500",
      idlePerMonth: "$260",
      eventsLast24Hours: 9730,
      usage30Days: "$1,500",
      attributed: "72%",
      topDepartment: "Engineering",
      agents: 3,
      tokens30Days: 88700000,
      conversations30Days: 4980,
    },
    sample: true,
  },
  {
    id: "sample-databricks-genie",
    name: "Databricks Genie",
    vendor: "Databricks",
    sourceType: "databricks_genie",
    badges: ["billed"],
    values: {
      seats: "no seats, billed on consumption",
      eventsLast24Hours: 640,
      usage30Days: "$2,980",
      attributed: "69%",
      topDepartment: "Data",
      agents: 7,
      conversations30Days: 1340,
    },
    sample: true,
  },
  {
    id: "sample-custom-agents",
    name: "Custom Agents",
    vendor: "In-house",
    sourceType: "http_custom",
    badges: ["metered"],
    values: {
      seats: "no seats, billed on consumption",
      eventsLast24Hours: 3120,
      usage30Days: "$740",
      attributed: "58%",
      topDepartment: "Engineering",
      agents: 18,
      tokens30Days: 31200000,
      conversations30Days: 2050,
    },
    sample: true,
  },
];
