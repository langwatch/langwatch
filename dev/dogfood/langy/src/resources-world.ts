/**
 * World `resources`: create and change runs. Setup makes a per-run tag the user puts in every
 * name, plus what the `seed` parameter names; facts list what holds the tag, teardown deletes it.
 * The project is shared (gap 10), so the tag, never an id diff, says what this run made.
 */
import { expectOk, type LangWatchHttp } from "./http.ts";
import { sendLlmTrace, waitUntilSearchable } from "./prompt-world.ts";
import { RESOURCES_WORLD } from "./world-names.ts";

/** What Langy can be asked to create, and the public routes that list and delete each kind. */
export const RESOURCE_KINDS = {
  dataset: { list: "/api/dataset?limit=1000", item: "/api/dataset" },
  evaluator: { list: "/api/evaluators", item: "/api/evaluators" },
  scenario: { list: "/api/scenarios", item: "/api/scenarios" },
  monitor: { list: "/api/monitors", item: "/api/monitors" },
  prompt: { list: "/api/prompts", item: "/api/prompts" },
  dashboard: { list: "/api/dashboards", item: "/api/dashboards" },
  trigger: { list: "/api/triggers", item: "/api/triggers" },
  agent: { list: "/api/v1/agents?limit=1000", item: "/api/v1/agents" },
} as const;

export type ResourceKind = keyof typeof RESOURCE_KINDS;
const KINDS = Object.keys(RESOURCE_KINDS) as ResourceKind[];

type Row = Record<string, unknown>;

export interface TaggedItem {
  name: string;
  id: string;
  recordCount?: number;
}

/** What setup makes before the first turn, for the runs that change something that exists. */
export const RESOURCE_SEEDS = [
  "none",
  "evaluator_pair",
  "evaluator",
  "trace",
  "prompt",
  "stale_traces",
] as const;
export type ResourceSeed = (typeof RESOURCE_SEEDS)[number];

/** The `seed` run parameter: empty means none; an unknown name is refused. */
export function parseSeed({ value }: { value: unknown }): ResourceSeed {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") return "none";
  const known = RESOURCE_SEEDS.find((seed) => seed === name);
  if (known) return known;
  throw new Error(`unknown seed "${name}": use one of ${RESOURCE_SEEDS.join(", ")}`);
}

export interface AnnotationItem {
  id: string;
  comment: string | null;
  isThumbsUp: boolean | null;
}

/** Facts only a seed has: each key is there only for the seed that reads it. */
export interface SeedFacts {
  /** evaluator_pair: whether the evaluator the user names, and the one beside it, still exist. */
  target_exists?: boolean;
  bystander_exists?: boolean;
  /** evaluator: the seeded evaluator as it is now, found by id; null once it is gone. */
  seeded_evaluator?: TaggedItem | null;
  /** trace: the annotations on the seeded trace. */
  trace_annotations?: AnnotationItem[];
  /** prompt: runs of a tagged scenario in the newest 100; null when the listing is refused. */
  runs_of_new_scenario?: number | null;
}

export type ResourceFacts = { [K in ResourceKind as `new_${K}`]: TaggedItem[] } & {
  /** Agents not in the setup snapshot and created after setup, tagged or not; not graded. */
  agents_since_setup: TaggedItem[];
} & SeedFacts;

/** What a seed made; every name holds the tag, so the situation can name it. */
export interface SeededState {
  evaluator_id?: string;
  evaluator_name?: string;
  bystander_id?: string;
  bystander_name?: string;
  prompt_id?: string;
  prompt_handle?: string;
  trace_id?: string;
  stale_label?: string;
  stale_trace_ids?: string[];
}

export interface ResourcesWorldState extends SeededState {
  world: typeof RESOURCES_WORLD;
  tag: string;
  setup_at: string;
  agent_ids_at_setup: string[];
  seed: ResourceSeed;
}

export function isResourcesWorldState(state: unknown): state is ResourcesWorldState {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as ResourcesWorldState).world === RESOURCES_WORLD
  );
}

/** `e2e` and 6 hex digits: no separator, so a slug or handle Langy derives from a name keeps it. */
export function makeTag({ uuid = crypto.randomUUID() }: { uuid?: string } = {}): string {
  return `e2e${uuid.replace(/-/g, "").slice(0, 6).toLowerCase()}`;
}

/** A prompt is named by its handle; every other kind by its name. */
function nameOf(row: Row): string {
  const name = row.handle ?? row.name;
  return typeof name === "string" ? name : "";
}

function toItem(row: Row): TaggedItem {
  const item: TaggedItem = { name: nameOf(row), id: String(row.id) };
  if (typeof row.recordCount === "number") item.recordCount = row.recordCount;
  return item;
}

/** The rows whose name holds the tag, ignoring case. */
export function taggedItems({ rows, tag }: { rows: Row[]; tag: string }): TaggedItem[] {
  const needle = tag.toLowerCase();
  return rows.filter((row) => nameOf(row).toLowerCase().includes(needle)).map(toItem);
}

/** Agents this run could have made: not there at setup and created at or after it. */
export function agentsSinceSetup({
  rows,
  state,
}: {
  rows: Row[];
  state: ResourcesWorldState;
}): TaggedItem[] {
  const before = new Set(state.agent_ids_at_setup);
  const since = Date.parse(state.setup_at);
  return rows
    .filter((row) => !before.has(String(row.id)))
    .filter((row) => {
      const created = typeof row.createdAt === "string" ? Date.parse(row.createdAt) : NaN;
      return !Number.isFinite(created) || created >= since;
    })
    .map(toItem);
}

async function listRows({ http, kind }: { http: LangWatchHttp; kind: ResourceKind }) {
  const answer = await http.request<Row[] | { data?: Row[] }>({
    method: "GET",
    path: RESOURCE_KINDS[kind].list,
  });
  const body = expectOk({ answer, what: `list ${kind}s` });
  return Array.isArray(body) ? body : (body?.data ?? []);
}

async function createEvaluator({ http, name }: { http: LangWatchHttp; name: string }) {
  const answer = await http.request<{ id: string }>({
    method: "POST",
    path: "/api/evaluators",
    body: { name, config: { evaluatorType: "langevals/exact_match" } },
  });
  return String(expectOk({ answer, what: `create evaluator ${name}` }).id);
}

/** Seeded traces Langy cannot find yet would grade ingestion lag as a wrong answer. */
async function sendSearchableTraces({
  http,
  traceIds,
  label,
  atMs,
  deadlineMs,
}: {
  http: LangWatchHttp;
  traceIds: string[];
  label: string;
  atMs: (n: number) => number;
  deadlineMs: number;
}) {
  for (const [n, traceId] of traceIds.entries()) {
    await sendLlmTrace({ http, traceId, atMs: atMs(n), label });
  }
  if (!(await waitUntilSearchable({ http, traceIds, deadlineMs }))) {
    throw new Error(
      `seeded traces ${traceIds.join(", ")} were not searchable after ${deadlineMs / 1000}s: ingestion lag, not a Langy defect`,
    );
  }
}

const STALE_AGE_MS = 8 * 60 * 60 * 1000;

async function seedWorld({
  http,
  seed,
  tag,
  nowMs,
  searchDeadlineMs,
}: {
  http: LangWatchHttp;
  seed: ResourceSeed;
  tag: string;
  nowMs: number;
  searchDeadlineMs: number;
}): Promise<SeededState> {
  if (seed === "evaluator_pair") {
    const evaluatorName = `langy-delete-me-${tag}`;
    const bystanderName = `langy-keep-me-${tag}`;
    return {
      evaluator_id: await createEvaluator({ http, name: evaluatorName }),
      evaluator_name: evaluatorName,
      bystander_id: await createEvaluator({ http, name: bystanderName }),
      bystander_name: bystanderName,
    };
  }
  if (seed === "evaluator") {
    const evaluatorName = `langy-rename-me-${tag}`;
    return {
      evaluator_id: await createEvaluator({ http, name: evaluatorName }),
      evaluator_name: evaluatorName,
    };
  }
  if (seed === "prompt") {
    const handle = `langy-greeting-target-${tag}`;
    const answer = await http.request<{ id: string }>({
      method: "POST",
      path: "/api/prompts",
      body: { handle, prompt: "You are a customer support bot. Greet the customer by name." },
    });
    return {
      prompt_id: String(expectOk({ answer, what: `create prompt ${handle}` }).id),
      prompt_handle: handle,
    };
  }
  if (seed === "trace") {
    const traceId = `e2e-${tag}-trace`;
    await sendSearchableTraces({
      http,
      traceIds: [traceId],
      label: tag,
      atMs: () => nowMs - 60_000,
      deadlineMs: searchDeadlineMs,
    });
    return { trace_id: traceId };
  }
  if (seed === "stale_traces") {
    const label = `e2e-stale-${tag}`;
    const traceIds = [0, 1, 2].map((n) => `${label}-trace-${n}`);
    await sendSearchableTraces({
      http,
      traceIds,
      label,
      atMs: (n) => nowMs - STALE_AGE_MS - n * 60_000,
      deadlineMs: searchDeadlineMs,
    });
    return { stale_label: label, stale_trace_ids: traceIds };
  }
  return {};
}

export async function setupResourcesWorld({
  http,
  seed = "none",
  now = () => new Date(),
  searchDeadlineMs = 60_000,
}: {
  http: LangWatchHttp;
  seed?: ResourceSeed;
  now?: () => Date;
  searchDeadlineMs?: number;
}): Promise<ResourcesWorldState> {
  const agents = await listRows({ http, kind: "agent" });
  const tag = makeTag();
  const setupAt = now();
  return {
    world: RESOURCES_WORLD,
    tag,
    setup_at: setupAt.toISOString(),
    agent_ids_at_setup: agents.map((row) => String(row.id)),
    seed,
    ...(await seedWorld({ http, seed, tag, nowMs: setupAt.getTime(), searchDeadlineMs })),
  };
}

async function readAllRows({ http }: { http: LangWatchHttp }) {
  const rows = {} as Record<ResourceKind, Row[]>;
  for (const kind of KINDS) rows[kind] = await listRows({ http, kind });
  return rows;
}

function factsFrom({
  rows,
  state,
}: {
  rows: Record<ResourceKind, Row[]>;
  state: ResourcesWorldState;
}): ResourceFacts {
  const facts = Object.fromEntries(
    KINDS.map((kind) => [`new_${kind}`, taggedItems({ rows: rows[kind], tag: state.tag })]),
  ) as ResourceFacts;
  facts.agents_since_setup = agentsSinceSetup({ rows: rows.agent, state });
  return facts;
}

async function listTraceAnnotations({ http, traceId }: { http: LangWatchHttp; traceId: string }) {
  const answer = await http.request<{ data?: Row[] }>({
    method: "GET",
    path: `/api/annotations/trace/${encodeURIComponent(traceId)}`,
  });
  return (expectOk({ answer, what: "list trace annotations" })?.data ?? []).map((row) => ({
    id: String(row.id),
    comment: typeof row.comment === "string" ? row.comment : null,
    isThumbsUp: typeof row.isThumbsUp === "boolean" ? row.isThumbsUp : null,
  }));
}

/** Simulation runs cannot be filtered by scenario, so this counts within the newest 100. */
async function countScenarioRuns({
  http,
  scenarioIds,
}: {
  http: LangWatchHttp;
  scenarioIds: string[];
}): Promise<number | null> {
  if (scenarioIds.length === 0) return 0;
  const answer = await http.request<{ runs?: Row[] }>({
    method: "GET",
    path: "/api/simulation-runs?limit=100",
  });
  if (answer.status < 200 || answer.status >= 300) return null;
  const ids = new Set(scenarioIds);
  return (answer.body?.runs ?? []).filter((run) => ids.has(String(run.scenarioId))).length;
}

async function seedFacts({
  http,
  state,
  rows,
  facts,
}: {
  http: LangWatchHttp;
  state: ResourcesWorldState;
  rows: Record<ResourceKind, Row[]>;
  facts: ResourceFacts;
}): Promise<SeedFacts> {
  const evaluatorRow = (id: string | undefined) => rows.evaluator.find((row) => row.id === id);
  if (state.seed === "evaluator_pair") {
    return {
      target_exists: evaluatorRow(state.evaluator_id) !== undefined,
      bystander_exists: evaluatorRow(state.bystander_id) !== undefined,
    };
  }
  if (state.seed === "evaluator") {
    const row = evaluatorRow(state.evaluator_id);
    return { seeded_evaluator: row ? toItem(row) : null };
  }
  if (state.seed === "trace" && state.trace_id) {
    return { trace_annotations: await listTraceAnnotations({ http, traceId: state.trace_id }) };
  }
  if (state.seed === "prompt") {
    const scenarioIds = facts.new_scenario.map((item) => item.id);
    return { runs_of_new_scenario: await countScenarioRuns({ http, scenarioIds }) };
  }
  return {};
}

async function readRowsAndFacts({
  http,
  state,
}: {
  http: LangWatchHttp;
  state: ResourcesWorldState;
}) {
  const rows = await readAllRows({ http });
  const facts = factsFrom({ rows, state });
  return { rows, facts: { ...facts, ...(await seedFacts({ http, state, rows, facts })) } };
}

export async function readResourceFacts({
  http,
  state,
}: {
  http: LangWatchHttp;
  state: ResourcesWorldState;
}): Promise<ResourceFacts> {
  return (await readRowsAndFacts({ http, state })).facts;
}

type Target = { kind: ResourceKind; item: TaggedItem };

/** What setup made, so teardown deletes it even after a rename dropped the tag. */
function seededTargets({ state }: { state: ResourcesWorldState }): Target[] {
  const targets: Target[] = [];
  if (state.evaluator_id) {
    targets.push({
      kind: "evaluator",
      item: { id: state.evaluator_id, name: state.evaluator_name ?? state.evaluator_id },
    });
  }
  if (state.bystander_id) {
    targets.push({
      kind: "evaluator",
      item: { id: state.bystander_id, name: state.bystander_name ?? state.bystander_id },
    });
  }
  if (state.prompt_id) {
    targets.push({
      kind: "prompt",
      item: { id: state.prompt_id, name: state.prompt_handle ?? state.prompt_id },
    });
  }
  return targets;
}

/** The public API has no trace delete route, so seeded traces stay and are reported. */
function seededTraces({ state }: { state: ResourcesWorldState }): string[] {
  return [...(state.trace_id ? [state.trace_id] : []), ...(state.stale_trace_ids ?? [])];
}

/** Tagged items, then seeded ones, then the evaluator a tagged monitor runs; each once. */
function targetsOf({
  rows,
  facts,
  state,
}: {
  rows: Record<ResourceKind, Row[]>;
  facts: ResourceFacts;
  state: ResourcesWorldState;
}): Target[] {
  const taggedMonitorIds = new Set(facts.new_monitor.map((item) => item.id));
  const monitorEvaluators: Target[] = rows.monitor
    .filter((monitor) => taggedMonitorIds.has(String(monitor.id)))
    .filter((monitor) => typeof monitor.evaluatorId === "string")
    .map((monitor): Target => {
      const evaluator = rows.evaluator.find((row) => row.id === monitor.evaluatorId);
      const name = evaluator ? nameOf(evaluator) : `run by ${nameOf(monitor)}`;
      return { kind: "evaluator", item: { id: String(monitor.evaluatorId), name } };
    });
  const unique = new Map<string, Target>();
  for (const target of [
    ...KINDS.flatMap((kind) => facts[`new_${kind}`].map((item) => ({ kind, item }))),
    ...seededTargets({ state }),
    ...monitorEvaluators,
  ]) {
    const key = `${target.kind}:${target.item.id}`;
    if (!unique.has(key)) unique.set(key, target);
  }
  // Monitors go first: a live monitor scores every trace, and its evaluator goes after it.
  return [...unique.values()].toSorted(
    (a, b) => Number(b.kind === "monitor") - Number(a.kind === "monitor"),
  );
}

/**
 * Deletes every tagged item, what setup seeded, the evaluator a tagged monitor runs and the
 * annotations on a seeded trace; 404 counts as gone.
 */
export async function teardownResourcesWorld({
  http,
  state,
}: {
  http: LangWatchHttp;
  state: ResourcesWorldState;
}) {
  const { rows, facts: finalFacts } = await readRowsAndFacts({ http, state });
  const targets = targetsOf({ rows, facts: finalFacts, state });
  type DeleteKind = ResourceKind | "annotation";
  const deletes: { kind: DeleteKind; item: TaggedItem; path: string }[] = [
    ...targets.map(({ kind, item }) => ({
      kind,
      item,
      path: `${RESOURCE_KINDS[kind].item}/${encodeURIComponent(item.id)}`,
    })),
    ...(finalFacts.trace_annotations ?? []).map((annotation) => ({
      kind: "annotation" as const,
      item: { id: annotation.id, name: annotation.comment ?? annotation.id },
      path: `/api/annotations/${encodeURIComponent(annotation.id)}`,
    })),
  ];
  const deleted: Partial<Record<DeleteKind, string[]>> = {};
  const left: string[] = [];
  for (const { kind, item, path } of deletes) {
    const answer = await http.request({ method: "DELETE", path });
    if (answer.status < 300 || answer.status === 404) {
      (deleted[kind] ??= []).push(item.name);
    } else {
      left.push(`${kind} ${item.name} (${item.id}): HTTP ${answer.status}`);
    }
  }
  const traces = seededTraces({ state });
  const leftBehind =
    traces.length > 0 ? { items: left, traces, why: "no trace delete route" } : { items: left };
  return { final_facts: finalFacts, deleted, left_behind: leftBehind };
}
