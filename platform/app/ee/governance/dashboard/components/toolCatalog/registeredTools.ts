// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AiToolEntry, AiToolTileType } from "~/components/me/tiles/types";

import {
  TOOL_CARD_ROWS,
  type ToolCard,
  type ToolCardBadge,
  type ToolCardRow,
} from "./toolCards";

/**
 * Turning the organization's tool registry into catalog cards.
 *
 * The registry is `AiToolEntry` — the rows an admin creates in the tool
 * catalog and the starter pack seeds. This module is the only place that
 * decides, for one registered tool, three things: how it is paid for, which
 * rows it therefore has, and whose mark it wears. Kept pure and away from the
 * renderers so all three are testable without a DOM, because the first of them
 * decides what a renewal screen claims about a contract.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */

/**
 * How a tool is paid for. This is the single fact the whole applicability
 * table hangs off, because it is what decides which rows can ever hold a
 * figure.
 *
 *   - `seat`      the vendor bills per named seat, so seats can go unassigned
 *                 and unassigned seats cost money (Copilot Business, Cursor).
 *   - `subscription` each person carries their own plan, so the count that
 *                 matters is how many plans, not how many seats an admin
 *                 assigned (Claude Code on a Claude plan, Codex on a ChatGPT
 *                 plan, Gemini on a Code Assist plan).
 *   - `consumption` billed on what it used, so the billed unit — tokens — is a
 *                 fact in its own right beside the dollar figure (every model
 *                 provider, and an assistant that runs on a key you supply).
 *   - `unknown`   we have not been told, and we do not guess. Payment rows are
 *                 simply absent rather than shown as a promise.
 */
export type ToolBilling = "seat" | "subscription" | "consumption" | "unknown";

/**
 * How each coding assistant we ship a wrapper for is actually bought.
 *
 * Deliberately per assistant rather than per type: "coding assistant" is not a
 * billing model. Copilot Business and Cursor Business bill an admin per named
 * seat and leave unassigned seats to be found; Claude Code, Codex and Gemini
 * ride the person's own plan and have no seat list to read; opencode is open
 * source and runs on a key the person supplies, so what it costs is what it
 * consumed.
 *
 * An assistant kind missing from this map — `custom`, or one added to the
 * picker before this map catches up — falls to `unknown`, which shows no
 * payment rows at all. That is the honest default: a made-up billing model
 * would put a Seats row on a tool nobody buys seats for.
 */
const ASSISTANT_BILLING: Record<string, ToolBilling> = {
  claude_code: "subscription",
  claude_cowork: "subscription",
  codex: "subscription",
  gemini: "subscription",
  opencode: "consumption",
  cursor: "seat",
  github_copilot: "seat",
};

/**
 * Who makes each tool, as a customer says it.
 *
 * Display copy, so it lives here rather than being read off a provider
 * registry: the registry's keys are routing identifiers and several of them
 * ("bedrock", "google") are not how anyone names the company on a renewal.
 */
const ASSISTANT_VENDOR: Record<string, string> = {
  claude_code: "Anthropic",
  claude_cowork: "Anthropic",
  codex: "OpenAI",
  gemini: "Google",
  opencode: "Open source",
  cursor: "Anysphere",
  github_copilot: "GitHub",
};

const PROVIDER_VENDOR: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  azure: "Microsoft",
  bedrock: "Amazon Web Services",
  google: "Google",
  vertex: "Google",
  gemini: "Google",
  deepseek: "DeepSeek",
  groq: "Groq",
  mistral: "Mistral",
  cohere: "Cohere",
  cloudflare: "Cloudflare",
};

/** Said when the registry does not tell us who makes a tool. */
const VENDOR_UNKNOWN = "Vendor not recorded";

/** What an organization's own internal tool is attributed to. */
const VENDOR_IN_HOUSE = "In-house";

/**
 * The rows every tool has whatever it costs: what it did, and who did it.
 *
 * Volume and attribution are properties of the traffic, not of the contract,
 * so they survive every billing model. They are also the rows the platform is
 * closest to being able to fill.
 */
const ACTIVITY_ROWS: readonly ToolCardRow[] = [
  "eventsLast24Hours",
  "usage30Days",
  "attributed",
  "topDepartment",
];

/**
 * The rows a billing model adds.
 *
 * `tokens30Days` appears once, under `consumption`, and that is the whole
 * argument for keeping the row at all. On a seat- or subscription-billed tool
 * the token count is the dollar figure told twice — the money is fixed by the
 * contract and the tokens move nothing — so the row is the same fact in a
 * second typeface. On a consumption-billed one the tokens ARE the billed unit,
 * and they separate from the dollars whenever a price changes, which is
 * exactly the question the catalog is read for.
 */
const BILLING_ROWS: Record<ToolBilling, readonly ToolCardRow[]> = {
  seat: ["seats", "licencePerMonth", "idlePerMonth"],
  subscription: ["subscriptions"],
  consumption: ["tokens30Days"],
  unknown: [],
};

/**
 * The rows a tool's own shape adds, on top of what it costs.
 *
 * An internal tool is something the organization built and runs, so it is the
 * one registry type that can hold a fleet of agents and a conversation stream.
 * A coding assistant is one agent on one person's machine and reports spans
 * rather than conversations; a model provider serves requests, and neither an
 * agent count nor a conversation count means anything against it.
 */
const TYPE_ROWS: Record<AiToolTileType, readonly ToolCardRow[]> = {
  coding_assistant: [],
  model_provider: [],
  external_tool: ["agents", "conversations30Days"],
};

const CONFIG_STRING = (
  config: Record<string, unknown>,
  key: string,
): string => {
  const value = config[key];
  return typeof value === "string" ? value : "";
};

/** The registry entry, narrowed to what this module reads off it. */
export interface RegisteredTool {
  id: string;
  displayName: string;
  type: AiToolTileType;
  iconAsset?: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
}

/**
 * Whether this tool's own traffic is real per-token money.
 *
 * A coding assistant normally rides a flat plan, so its list-price token cost
 * is theoretical and the cost-attribution policy stamps its direct usage
 * non-billable. An admin who unticks "Bundled subscription" is saying the
 * opposite about that same tool, and the receiver believes them: from then on
 * its tokens are spend. Without this the catalog contradicted the entry it is
 * a summary of — a Claude Code tile with the box unticked was labelled
 * Subscription, carried a subscriptions row, and hid the token count that had
 * just become the interesting figure on it.
 *
 * A SECOND FACT, not a replacement. The plan or the seats are still bought;
 * unticking the box does not refund them. So this adds the metered row and
 * badge alongside the contract's, the way a seat-billed tool that also meters
 * credits carries both.
 *
 * Only an explicit `false` counts. The field is optional and the ingest path
 * defaults it to true, so an entry nobody has opened must not read as metered.
 *
 * Scoped to coding assistants because that is the only type the policy reads.
 * A model provider is already consumption-billed, and gateway traffic is
 * billed per token whatever any tile says — it never reaches this path.
 */
function isMeteredPerToken(tool: RegisteredTool): boolean {
  return tool.type === "coding_assistant" && tool.config.bundledPlan === false;
}

/** How this tool is paid for, from what the registry entry actually says. */
export function billingForTool(tool: RegisteredTool): ToolBilling {
  if (tool.type === "model_provider") return "consumption";
  // An internal tool is built, not bought. There is no contract to read, so no
  // payment row applies — what it costs shows up as the usage it drove.
  if (tool.type === "external_tool") return "unknown";
  return (
    ASSISTANT_BILLING[CONFIG_STRING(tool.config, "assistantKind")] ?? "unknown"
  );
}

/**
 * The rows this tool has, in {@link TOOL_CARD_ROWS} order.
 *
 * Ordered against the canonical list rather than concatenated, so the card and
 * the table read every tool's rows in the same sequence however the sets are
 * composed.
 */
export function applicableRowsForTool(
  tool: RegisteredTool,
): readonly ToolCardRow[] {
  const rows = new Set<ToolCardRow>([
    ...BILLING_ROWS[billingForTool(tool)],
    // The admin's explicit override, on top of what the kind implies.
    ...(isMeteredPerToken(tool) ? BILLING_ROWS.consumption : []),
    ...ACTIVITY_ROWS,
    // `?? []` because this lookup is NOT total, however much the type says it
    // is. `type` is a bare String column, the payload reaches us through a
    // double cast that validates nothing, and `AiToolTileType` is a
    // hand-written union that does not derive from the service's
    // SUPPORTED_TILE_TYPES — adding a fourth member there typechecks clean.
    // A key this map has not heard of would otherwise spread `undefined` and
    // throw, taking the whole Catalog pane down over one unrecognised row.
    // Degrading to "no type-specific rows" loses two rows on one card.
    ...(TYPE_ROWS[tool.type] ?? []),
  ]);
  return TOOL_CARD_ROWS.filter((row) => rows.has(row));
}

/** Who makes this tool, or an admission that the registry does not say. */
export function vendorForTool(tool: RegisteredTool): string {
  if (tool.type === "external_tool") return VENDOR_IN_HOUSE;
  if (tool.type === "model_provider") {
    const key = CONFIG_STRING(tool.config, "providerKey").toLowerCase();
    return PROVIDER_VENDOR[key] ?? VENDOR_UNKNOWN;
  }
  return (
    ASSISTANT_VENDOR[CONFIG_STRING(tool.config, "assistantKind")] ??
    VENDOR_UNKNOWN
  );
}

/**
 * The badges a registered tool earns.
 *
 * The badge says where a figure WOULD come from, which is what a reader
 * looking at an empty Usage row needs to know. It never claims a figure.
 * `unknown` billing earns no badge rather than a "billing not recorded" one:
 * an absent badge is already the absence, and a badge saying so would be the
 * loudest thing on a card that has nothing to report.
 */
export function badgesForTool(tool: RegisteredTool): ToolCardBadge[] {
  const contract = ((): ToolCardBadge[] => {
    switch (billingForTool(tool)) {
      case "seat":
        return ["seatsAndLicences", "billed"];
      case "subscription":
        return ["subscription"];
      case "consumption":
        return ["metered"];
      case "unknown":
        return [];
    }
  })();
  // Deduped rather than appended blindly: a consumption-billed tool already
  // wears this mark, and saying it twice reads as two different facts.
  return isMeteredPerToken(tool)
    ? [...new Set<ToolCardBadge>([...contract, "metered"])]
    : contract;
}

/**
 * The real cards: one per registered tool.
 *
 * Every card comes back with an empty `values`. That is not an oversight and
 * it is not a loading state — it is the true state of this branch. Every read
 * behind these rows is keyed by organization or by ingestion source, and none
 * of them can be narrowed to one registered tool, so each applicable row draws
 * its dash and the sentence naming what would fill it. The pane used to show
 * one measured figure here, a source's 24-hour event count, by treating a
 * source as if it were a tool; that number was real but it was the wrong
 * thing's number, so it is gone rather than relabelled.
 */
export function buildRegisteredToolCards({
  tools,
}: {
  tools: readonly RegisteredTool[];
}): ToolCard[] {
  return tools.map((tool) => ({
    id: tool.id,
    name: tool.displayName,
    vendor: vendorForTool(tool),
    sourceType: null,
    tile: { iconAsset: tool.iconAsset ?? null, type: tool.type },
    badges: badgesForTool(tool),
    applicableRows: applicableRowsForTool(tool),
    values: {},
    enabled: tool.enabled,
  }));
}

/** The registry rows as this module reads them, from the router's payload. */
export function asRegisteredTools(
  entries: readonly AiToolEntry[] | undefined,
): RegisteredTool[] {
  return (entries ?? []).map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    type: entry.type,
    iconAsset: entry.iconAsset ?? null,
    enabled: entry.enabled,
    config: entry.config as unknown as Record<string, unknown>,
  }));
}
