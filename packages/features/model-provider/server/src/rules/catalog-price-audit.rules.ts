import type { LLMModelEntry, LLMModelPricing } from "@langwatch/model-provider-contract";

/**
 * Catalog audit: the four ways a model price goes wrong without anyone
 * noticing. All four bill a real request at the wrong amount and none of
 * them shows up as an error anywhere in the product.
 *
 * 1. No price. A model with no rate any cost field can hold prices every
 *    request at zero — the spend row still settles, so the failure looks
 *    like a cheap customer rather than a defect.
 * 2. Wrong unit. An entry priced in a unit the vendor does not bill in also
 *    bills zero, invisibly to a check that only asks whether a price exists.
 * 3. Drift. A hand-written overlay entry never expires; once the vendor's
 *    price changes the overlay keeps billing the old one and the sync
 *    cannot correct it, because the overlay exists to override the sync.
 * 4. Cross-source disagreement. The two price sources are independent, so
 *    where they disagree materially one of them is wrong and it was
 *    imported with full confidence.
 *
 * The audit reports, it does not correct — choosing a side needs a human.
 * A baseline file holds findings already known and accepted, so the run is
 * green until something NEW appears.
 */

/** Rate fields that can actually price a request, grouped by billing unit. */
const FIELD_UNITS = {
  inputCostPerToken: "token",
  outputCostPerToken: "token",
  audioCostPerToken: "token",
  inputCacheReadPerToken: "token",
  inputCacheWritePerToken: "token",
  inputCacheWrite1hPerToken: "token",
  inputCostPerCharacter: "character",
  inputCostPerSecond: "second",
} as const satisfies Partial<Record<keyof LLMModelPricing, string>>;

const PRICEABLE_FIELDS = Object.keys(FIELD_UNITS) as (keyof typeof FIELD_UNITS)[];

/**
 * Models the catalog prices at zero on purpose: Codex bills the user's
 * ChatGPT plan, and every `openrouter/` id is a router rather than a model.
 */
const PRICED_ELSEWHERE = [/^openai_codex\//, /^openrouter\//];

export function isPricedElsewhere(modelId: string): boolean {
  return PRICED_ELSEWHERE.some((pattern) => pattern.test(modelId));
}

/** The distinct billing units a pricing entry actually charges for. */
export function pricedUnits(pricing: LLMModelPricing | undefined): string[] {
  const units: string[] = [];
  if (!pricing) return units;
  for (const field of PRICEABLE_FIELDS) {
    const unit = FIELD_UNITS[field];
    if ((pricing[field] ?? 0) > 0 && !units.includes(unit)) units.push(unit);
  }
  return units;
}

export function hasAnyRate(pricing: LLMModelPricing | undefined): boolean {
  return pricedUnits(pricing).length > 0;
}

/** Catalog entries that would price every request at zero. */
export function findUnpricedModels(models: Record<string, LLMModelEntry>): string[] {
  return Object.keys(models)
    .filter((id) => !isPricedElsewhere(id) && !hasAnyRate(models[id]?.pricing))
    .sort();
}

export type UnitMismatch = {
  modelId: string;
  origin: "overlay" | "generated";
  catalogUnits: string[];
  upstreamUnits: string[];
  source: string;
};

export type PriceDisagreement = {
  modelId: string;
  origin: "overlay" | "generated";
  field: string;
  catalog: number;
  upstream: number;
  /** Relative gap, 0 to 1. */
  gap: number;
  source: string;
};

export type AuditReport = {
  unpriced: string[];
  unitMismatch: UnitMismatch[];
  /** Hand-written overlay rates that disagree with upstream. */
  drift: PriceDisagreement[];
  /** Generated rates that disagree between the two upstream sources. */
  crossSource: PriceDisagreement[];
  /** Overlay entries that override a base-catalog entry of the same id. */
  overriding: string[];
  /** Models upstream prices that the catalog cannot express yet. */
  unrepresentable: { id: string; fields: string[] }[];
};

/** Below this the two sources are quoting the same price with different rounding. */
const MATERIAL_GAP = 0.05;

function relativeGap(a: number, b: number): number {
  if (a === b) return 0;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? 0 : Math.abs(a - b) / scale;
}

/**
 * Compares a catalog entry against one upstream source. Only fields BOTH
 * sides price are compared for value — a field one side carries alone is a
 * coverage difference, not a wrong number.
 */
function compareEntry(
  modelId: string,
  origin: "overlay" | "generated",
  catalog: LLMModelPricing,
  upstream: LLMModelPricing,
  source: string,
): { mismatch: UnitMismatch | null; disagreements: PriceDisagreement[] } {
  const catalogUnits = pricedUnits(catalog);
  const upstreamUnits = pricedUnits(upstream);

  let mismatch: UnitMismatch | null = null;
  if (catalogUnits.length > 0 && upstreamUnits.length > 0) {
    const shared = catalogUnits.some((unit) => upstreamUnits.includes(unit));
    if (!shared) {
      mismatch = {
        modelId,
        origin,
        catalogUnits: [...catalogUnits].sort(),
        upstreamUnits: [...upstreamUnits].sort(),
        source,
      };
    }
  }

  const disagreements: PriceDisagreement[] = [];
  for (const field of PRICEABLE_FIELDS) {
    const ours = catalog[field];
    const theirs = upstream[field];
    if (!ours || !theirs) continue;
    const gap = relativeGap(ours, theirs);
    if (gap > MATERIAL_GAP) {
      disagreements.push({ modelId, origin, field, catalog: ours, upstream: theirs, gap, source });
    }
  }

  return { mismatch, disagreements };
}

export function auditCatalog({
  overlay,
  generated,
  upstream,
  unrepresentable = [],
}: {
  overlay: Record<string, LLMModelEntry>;
  generated: Record<string, LLMModelEntry>;
  /** Catalog-shaped upstream pricing by model id, per source name. */
  upstream: Record<string, Record<string, LLMModelPricing>>;
  unrepresentable?: { id: string; fields: string[] }[];
}): AuditReport {
  const unitMismatch: UnitMismatch[] = [];
  const drift: PriceDisagreement[] = [];
  const crossSource: PriceDisagreement[] = [];
  const overriding: string[] = [];

  const check = (
    models: Record<string, LLMModelEntry>,
    origin: "overlay" | "generated",
    into: PriceDisagreement[],
  ) => {
    for (const [modelId, entry] of Object.entries(models)) {
      if (isPricedElsewhere(modelId)) continue;
      if (!entry.pricing) continue;
      for (const [source, byId] of Object.entries(upstream)) {
        const upstreamPricing = byId[modelId];
        if (!upstreamPricing) continue;
        const result = compareEntry(modelId, origin, entry.pricing, upstreamPricing, source);
        if (result.mismatch) unitMismatch.push(result.mismatch);
        into.push(...result.disagreements);
      }
    }
  };

  check(overlay, "overlay", drift);
  check(generated, "generated", crossSource);

  for (const modelId of Object.keys(overlay)) {
    if (generated[modelId]) overriding.push(modelId);
  }

  const byGap = (a: PriceDisagreement, b: PriceDisagreement) => b.gap - a.gap;
  drift.sort(byGap);
  crossSource.sort(byGap);
  unitMismatch.sort((a, b) => a.modelId.localeCompare(b.modelId));

  return {
    unpriced: findUnpricedModels({ ...overlay, ...generated }),
    unitMismatch,
    drift,
    crossSource,
    overriding: overriding.sort(),
    unrepresentable,
  };
}

export type AuditBaseline = {
  /** Model ids allowed to carry no price, each with the reason. */
  unpriced?: Record<string, string>;
  /** `modelId::field` keys allowed to disagree, each with the reason. */
  disagreements?: Record<string, string>;
  /** Model ids allowed to price a different unit than upstream. */
  unitMismatch?: Record<string, string>;
};

/**
 * Findings the baseline does not already account for. Cross-source
 * disagreements are reported but never blocking — a judgement call between
 * two third parties, not a defect with an obvious owner.
 */
export function blockingFindings(report: AuditReport, baseline: AuditBaseline): string[] {
  const blocking: string[] = [];

  for (const id of report.unpriced) {
    if (!baseline.unpriced?.[id]) blocking.push(`no price: ${id}`);
  }
  for (const m of report.unitMismatch) {
    if (!baseline.unitMismatch?.[m.modelId]) {
      blocking.push(
        `wrong unit: ${m.modelId} prices ${m.catalogUnits.join("+")}, ${m.source} bills ${m.upstreamUnits.join("+")}`,
      );
    }
  }
  for (const d of report.drift) {
    const key = `${d.modelId}::${d.field}`;
    if (!baseline.disagreements?.[key]) {
      blocking.push(`overlay drift: ${key} is ${d.catalog}, ${d.source} says ${d.upstream}`);
    }
  }

  return blocking;
}

const pct = (gap: number) => `${(gap * 100).toFixed(0)}%`;

function priceTable(rows: PriceDisagreement[]): string[] {
  return [
    "| Model | Field | Catalog | Upstream | Gap | Source |",
    "|-------|-------|---------|----------|-----|--------|",
    ...rows.map(
      (d) =>
        `| \`${d.modelId}\` | ${d.field} | ${d.catalog} | ${d.upstream} | ${pct(d.gap)} | ${d.source} |`,
    ),
  ];
}

/** Markdown for the weekly sync pull request body and the job log. */
export function renderAuditMarkdown(report: AuditReport, blocking: string[]): string {
  const out: string[] = ["## Price registry audit"];

  const nothing =
    report.unpriced.length === 0 &&
    report.unitMismatch.length === 0 &&
    report.drift.length === 0 &&
    report.crossSource.length === 0 &&
    report.unrepresentable.length === 0;
  if (nothing) {
    out.push(
      "",
      "No findings. Every model has a price, in the unit the vendor bills, and both price sources agree.",
    );
    return out.join("\n");
  }

  if (blocking.length > 0) {
    out.push(
      "",
      `**${blocking.length} new finding(s) need a decision before this merges.**`,
      "",
      ...blocking.map((line) => `- ${line}`),
    );
  }

  if (report.unpriced.length > 0) {
    out.push(
      "",
      `### No price (${report.unpriced.length})`,
      "",
      "These bill every request at zero dollars and the spend row still settles.",
      "",
      ...report.unpriced.map((id) => `- \`${id}\``),
    );
  }

  if (report.unitMismatch.length > 0) {
    out.push(
      "",
      `### Priced in a unit the vendor does not bill (${report.unitMismatch.length})`,
      "",
      "The entry looks complete and still rates every request at zero, because the usage never arrives in the unit it prices.",
      "",
      "| Model | Catalog prices | Vendor bills | Source |",
      "|-------|----------------|--------------|--------|",
      ...report.unitMismatch.map(
        (m) =>
          `| \`${m.modelId}\` | ${m.catalogUnits.join(", ")} | ${m.upstreamUnits.join(", ")} | ${m.source} |`,
      ),
    );
  }

  if (report.drift.length > 0) {
    out.push(
      "",
      `### Hand-written rates that disagree with upstream (${report.drift.length})`,
      "",
      "The overlay wins at load time, so these bill as written. Confirm which side is right, then correct the overlay or retire the entry.",
      "",
      ...priceTable(report.drift),
    );
  }

  if (report.crossSource.length > 0) {
    out.push(
      "",
      `### The two price sources disagree (${report.crossSource.length})`,
      "",
      "One of them is wrong and the catalog imported one of them. Worst gap first.",
      "",
      ...priceTable(report.crossSource),
    );
  }

  if (report.overriding.length > 0) {
    out.push(
      "",
      `### Overlay entries overriding the base catalog (${report.overriding.length})`,
      "",
      "The overlay wins for these ids. Each one needs a reason to still exist; retire it once upstream is right.",
      "",
      ...report.overriding.map((id) => `- \`${id}\``),
    );
  }

  if (report.unrepresentable.length > 0) {
    out.push(
      "",
      `### Priced upstream, not expressible in the catalog (${report.unrepresentable.length})`,
      "",
      "Held back on purpose. Importing a partial rate would bill confidently and wrongly.",
      "",
      "| Model | Needs a catalog field for |",
      "|-------|---------------------------|",
      ...report.unrepresentable.map((u) => `| \`${u.id}\` | ${u.fields.join(", ")} |`),
    );
  }

  return out.join("\n");
}
