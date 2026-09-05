/**
 * CAPABILITY_HYDRATORS — how each CLI resource's card fetches CURRENT data.
 */

import type { api } from "../../../../behavior/langy-api";
import { asFreeTextTerm } from "../../../../index";
import { traceMetaLine, truncateRowText } from "../../../../index";

/**
 * The trace row a card hydrates fresh, as this file reads it.
 */
type TraceRowPayload = {
  traceId: string;
  traceName?: string;
  name?: string;
  input?: string;
  output?: string;
  status?: string;
  timestamp?: number;
  durationMs?: number;
  totalCost?: number;
};

/** The tRPC utils proxy (`api.useUtils()`), for imperative `.fetch` calls. */
export type CapabilityTrpcUtils = ReturnType<typeof api.useUtils>;

/** One hydrated row, in the shared vocabulary every card draws. */
export interface CapabilityHydratedRow {
  id: string;
  /** Lead line — the trace's input, the dataset's name, the prompt's handle. */
  primary?: string;
  /** Meta line — when · latency · cost · failed, a status, a count. */
  secondary?: string;
  /** Epoch ms, when the entity has a time — drives trace drawer deep links. */
  timestamp?: number;
}

export interface CapabilityHydration {
  rows: CapabilityHydratedRow[];
  /** What the query matched in total, when the source reports it. */
  total?: number;
}

export interface CapabilityHydrator {
  byIds?: (a: {
    utils: CapabilityTrpcUtils;
    projectId: string;
    ids: string[];
  }) => Promise<CapabilityHydration>;
  byQuery?: (a: {
    utils: CapabilityTrpcUtils;
    projectId: string;
    query: Record<string, unknown>;
    limit: number;
  }) => Promise<CapabilityHydration>;
}

const ROW_TEXT_MAX = 90;

/** A flag's value as text, whichever of its spellings the command used. */
function queryText(query: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = query[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Epoch ms from a flag that may hold epoch ms or an ISO date. */
function queryEpochMs(query: Record<string, unknown>, keys: string[]): number | undefined {
  const raw = queryText(query, keys);
  if (raw === undefined) return undefined;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) return asNumber;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** The window the CLI searches by default when no dates are given. */
const DEFAULT_SEARCH_WINDOW_MS = 24 * 60 * 60 * 1000;

// ── traces ──────────────────────────────────────────────────────────────────

/**
 * One trace header per id, in id order, via the same `tracesV2.header` read the trace drawer uses (minus full IO
 * resolution — this fetches N traces and immediately truncates each to `ROW_TEXT_MAX`, so it's never worth the
 * extra spans read `full: true` costs).
 */
async function traceByIds({
  utils,
  projectId,
  ids,
}: {
  utils: CapabilityTrpcUtils;
  projectId: string;
  ids: string[];
}): Promise<CapabilityHydration> {
  const settled = await Promise.allSettled(
    ids.map((traceId) => utils.tracesV2.header.fetch({ projectId, traceId, full: false })),
  );
  const rows: CapabilityHydratedRow[] = [];
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const header = result.value;
    rows.push({
      id: ids[index]!,
      primary: header.input
        ? truncateRowText(header.input, ROW_TEXT_MAX)
        : header.traceName || ids[index]!,
      secondary: traceMetaLine({
        startedAt: header.timestamp,
        latencyMs: header.durationMs,
        ...(header.totalCost != null ? { cost: header.totalCost } : {}),
        isError: header.status === "error",
        ...(header.output ? { output: truncateRowText(header.output, ROW_TEXT_MAX) } : {}),
      }),
      timestamp: header.timestamp,
    });
  });
  return { rows };
}

/**
 * Re-run the agent's trace search through `tracesV2.list` — the Trace Explorer's own
 * read.
 */
async function traceByQuery({
  utils,
  projectId,
  query,
  limit,
}: {
  utils: CapabilityTrpcUtils;
  projectId: string;
  query: Record<string, unknown>;
  limit: number;
}): Promise<CapabilityHydration> {
  const to = queryEpochMs(query, ["end-date", "endDate"]) ?? Date.now();
  const from = queryEpochMs(query, ["start-date", "startDate"]) ?? to - DEFAULT_SEARCH_WINDOW_MS;
  const text = queryText(query, ["q", "query"]);

  const page = await utils.tracesV2.list.fetch({
    projectId,
    timeRange: { from, to },
    sort: { columnId: "time", direction: "desc" },
    page: 1,
    pageSize: limit,
    ...(text ? { query: asFreeTextTerm(text) } : {}),
  });

  return {
    rows: (page.items as TraceRowPayload[]).map((item) => ({
      id: item.traceId,
      primary: item.input
        ? truncateRowText(item.input, ROW_TEXT_MAX)
        : item.traceName || item.name || item.traceId,
      secondary: traceMetaLine({
        startedAt: item.timestamp,
        latencyMs: item.durationMs,
        cost: item.totalCost,
        isError: item.status === "error",
        ...(item.output ? { output: truncateRowText(item.output, ROW_TEXT_MAX) } : {}),
      }),
      timestamp: item.timestamp,
    })),
    total: page.totalHits,
  };
}

// ── datasets / prompts / experiments ────────────────────────────────────────

/** Match a referenced id against however the entity spells itself. */
function matchesId(entity: unknown, id: string, keys: string[]): boolean {
  // Accepts the raw tRPC row and narrows HERE — interfaces don't carry index
  // signatures, so typing the parameter as Record<string, unknown> would force
  // every call site into a cast instead of this one guarded read.
  if (typeof entity !== "object" || entity === null) return false;
  const record = entity as Record<string, unknown>;
  return keys.some((key) => record[key] === id);
}

async function datasetByIds({
  utils,
  projectId,
  ids,
}: {
  utils: CapabilityTrpcUtils;
  projectId: string;
  ids: string[];
}): Promise<CapabilityHydration> {
  const datasets = await utils.dataset.getAll.fetch({ projectId });
  const rows: CapabilityHydratedRow[] = [];
  for (const id of ids) {
    const dataset = datasets.find((candidate) => matchesId(candidate, id, ["id", "slug"]));
    if (!dataset) continue;
    const records = dataset.recordCount;
    rows.push({
      id: dataset.id,
      primary: dataset.name,
      secondary: `${records.toLocaleString()} ${records === 1 ? "record" : "records"}`,
    });
  }
  return { rows };
}

async function promptByIds({
  utils,
  projectId,
  ids,
}: {
  utils: CapabilityTrpcUtils;
  projectId: string;
  ids: string[];
}): Promise<CapabilityHydration> {
  const prompts = await utils.prompts.getAllPromptsForProject.fetch({
    projectId,
  });
  const rows: CapabilityHydratedRow[] = [];
  for (const id of ids) {
    const prompt = prompts.find((candidate) => matchesId(candidate, id, ["id", "handle"]));
    if (!prompt) continue;
    rows.push({
      id: prompt.id,
      primary: prompt.handle ?? prompt.name,
      ...(prompt.version != null ? { secondary: `version ${prompt.version}` } : {}),
    });
  }
  return { rows };
}

async function experimentByIds({
  utils,
  projectId,
  ids,
}: {
  utils: CapabilityTrpcUtils;
  projectId: string;
  ids: string[];
}): Promise<CapabilityHydration> {
  const experiments = await utils.experiments.getAllByProjectId.fetch({
    projectId,
  });
  const rows: CapabilityHydratedRow[] = [];
  for (const id of ids) {
    const experiment = experiments.find((candidate) => matchesId(candidate, id, ["slug", "id"]));
    if (!experiment) continue;
    rows.push({
      id: experiment.slug ?? experiment.id,
      primary: experiment.name ?? experiment.slug ?? experiment.id,
      ...(experiment.slug && experiment.name ? { secondary: experiment.slug } : {}),
    });
  }
  return { rows };
}

/**
 * One line per resource. Everything not listed here falls back to the digest /
 * stored-output rendering — deliberately, until a suitable procedure exists.
 */
export const CAPABILITY_HYDRATORS: Record<string, CapabilityHydrator> = {
  trace: { byIds: traceByIds, byQuery: traceByQuery },
  dataset: { byIds: datasetByIds },
  prompt: { byIds: promptByIds },
  experiment: { byIds: experimentByIds },
};
