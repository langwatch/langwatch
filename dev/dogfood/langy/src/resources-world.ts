/**
 * World `resources`: the create-then-check runs. Setup makes a per-run tag the user puts in every
 * name; the facts list the items whose name holds it, and teardown deletes exactly those. The
 * project is shared by every run (gap 10), so the tag, never an id diff, says what this run made.
 */
import { expectOk, type LangWatchHttp } from "./http.ts";
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

export type ResourceFacts = { [K in ResourceKind as `new_${K}`]: TaggedItem[] } & {
  /** Agents not in the setup snapshot and created after setup, tagged or not; not graded. */
  agents_since_setup: TaggedItem[];
};

export interface ResourcesWorldState {
  world: typeof RESOURCES_WORLD;
  tag: string;
  setup_at: string;
  agent_ids_at_setup: string[];
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

export async function setupResourcesWorld({
  http,
  now = () => new Date(),
}: {
  http: LangWatchHttp;
  now?: () => Date;
}): Promise<ResourcesWorldState> {
  const agents = await listRows({ http, kind: "agent" });
  return {
    world: RESOURCES_WORLD,
    tag: makeTag(),
    setup_at: now().toISOString(),
    agent_ids_at_setup: agents.map((row) => String(row.id)),
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

export async function readResourceFacts({
  http,
  state,
}: {
  http: LangWatchHttp;
  state: ResourcesWorldState;
}): Promise<ResourceFacts> {
  return factsFrom({ rows: await readAllRows({ http }), state });
}

/** Deletes every tagged item, plus the evaluator a tagged monitor runs; 404 counts as gone. */
export async function teardownResourcesWorld({
  http,
  state,
}: {
  http: LangWatchHttp;
  state: ResourcesWorldState;
}) {
  const rows = await readAllRows({ http });
  const finalFacts = factsFrom({ rows, state });
  const targets: { kind: ResourceKind; item: TaggedItem }[] = KINDS.flatMap((kind) =>
    finalFacts[`new_${kind}`].map((item) => ({ kind, item })),
  );
  const taggedMonitorIds = new Set(finalFacts.new_monitor.map((item) => item.id));
  const queued = new Set(targets.map(({ kind, item }) => `${kind}:${item.id}`));
  for (const monitor of rows.monitor) {
    const evaluatorId = monitor.evaluatorId;
    if (!taggedMonitorIds.has(String(monitor.id)) || typeof evaluatorId !== "string") continue;
    if (queued.has(`evaluator:${evaluatorId}`)) continue;
    const evaluator = rows.evaluator.find((row) => row.id === evaluatorId);
    targets.push({
      kind: "evaluator",
      item: { id: evaluatorId, name: evaluator ? nameOf(evaluator) : `run by ${nameOf(monitor)}` },
    });
    queued.add(`evaluator:${evaluatorId}`);
  }
  // Monitors go first: a live monitor scores every trace, and its evaluator goes after it.
  targets.sort((a, b) => Number(b.kind === "monitor") - Number(a.kind === "monitor"));
  const deleted: Partial<Record<ResourceKind, string[]>> = {};
  const left: string[] = [];
  for (const { kind, item } of targets) {
    const answer = await http.request({
      method: "DELETE",
      path: `${RESOURCE_KINDS[kind].item}/${encodeURIComponent(item.id)}`,
    });
    if (answer.status < 300 || answer.status === 404) {
      (deleted[kind] ??= []).push(item.name);
    } else {
      left.push(`${kind} ${item.name} (${item.id}): HTTP ${answer.status}`);
    }
  }
  return { final_facts: finalFacts, deleted, left_behind: { items: left } };
}
