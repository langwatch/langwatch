/**
 * World T1: the user asks Langy to set up Topic Clustering. Its settings are the project's model
 * defaults (Settings → Model Providers → Default Models); setup snapshots them, the facts name
 * what changed, and teardown puts them back.
 */
import { expectOk, type LangWatchHttp } from "./http.ts";
import { TOPIC_WORLD } from "./world-names.ts";

export interface ModelDefaultConfig {
  id: string;
  config: Record<string, string>;
}

export interface TopicWorldState {
  world: typeof TOPIC_WORLD;
  model_default_configs: ModelDefaultConfig[];
}

export interface TopicFacts {
  model_defaults_changed: boolean;
  changed_keys: string[];
  added_config_ids: string[];
  removed_config_ids: string[];
}

export function isTopicWorldState(state: unknown): state is TopicWorldState {
  return (
    typeof state === "object" && state !== null && (state as TopicWorldState).world === TOPIC_WORLD
  );
}

/** What changed in the model defaults since setup: configs added or removed, keys set or unset. */
export function diffModelDefaults({
  before,
  after,
}: {
  before: ModelDefaultConfig[];
  after: ModelDefaultConfig[];
}): TopicFacts {
  const beforeById = new Map(before.map((row) => [row.id, row.config]));
  const afterIds = new Set(after.map((row) => row.id));
  const changedKeys = new Set<string>();
  for (const row of after) {
    const old = beforeById.get(row.id) ?? {};
    for (const key of new Set([...Object.keys(old), ...Object.keys(row.config)])) {
      if (old[key] !== row.config[key]) changedKeys.add(key);
    }
  }
  const added = after.filter((row) => !beforeById.has(row.id)).map((row) => row.id);
  const removed = before.filter((row) => !afterIds.has(row.id)).map((row) => row.id);
  return {
    model_defaults_changed: changedKeys.size > 0 || removed.length > 0,
    changed_keys: [...changedKeys].toSorted(),
    added_config_ids: added,
    removed_config_ids: removed,
  };
}

async function readModelDefaults({ http }: { http: LangWatchHttp }): Promise<ModelDefaultConfig[]> {
  const answer = await http.request<{ configs?: ModelDefaultConfig[] }>({
    method: "GET",
    path: "/api/model-defaults",
  });
  return (expectOk({ answer, what: "read model defaults" }).configs ?? []).map(
    ({ id, config }) => ({
      id,
      config,
    }),
  );
}

export async function setupTopicWorld({ http }: { http: LangWatchHttp }): Promise<TopicWorldState> {
  return { world: TOPIC_WORLD, model_default_configs: await readModelDefaults({ http }) };
}

export async function readTopicFacts({
  http,
  state,
}: {
  http: LangWatchHttp;
  state: TopicWorldState;
}): Promise<TopicFacts> {
  return diffModelDefaults({
    before: state.model_default_configs,
    after: await readModelDefaults({ http }),
  });
}

/** The final facts, then the defaults as setup found them: changes undone, new configs deleted. */
export async function teardownTopicWorld({
  http,
  state,
}: {
  http: LangWatchHttp;
  state: TopicWorldState;
}) {
  const after = await readModelDefaults({ http });
  const finalFacts = diffModelDefaults({ before: state.model_default_configs, after });
  const restored: string[] = [];
  const deleted: string[] = [];
  const left: string[] = [];
  for (const original of state.model_default_configs) {
    const now = after.find((row) => row.id === original.id);
    if (!now) continue;
    const { changed_keys } = diffModelDefaults({ before: [original], after: [now] });
    if (changed_keys.length === 0) continue;
    const answer = await http.request({
      method: "PUT",
      path: `/api/model-defaults/${original.id}`,
      body: { config: original.config },
    });
    (answer.status < 300 ? restored : left).push(original.id);
  }
  for (const id of finalFacts.added_config_ids) {
    const answer = await http.request({ method: "DELETE", path: `/api/model-defaults/${id}` });
    (answer.status < 300 ? deleted : left).push(id);
  }
  left.push(
    ...finalFacts.removed_config_ids.map((id) => `${id} (deleted by the run, not recreated)`),
  );
  return {
    final_facts: finalFacts,
    restored,
    deleted,
    left_behind: {
      configs: left,
      clustering_runs: "a clustering run Langy started stays (no public API reads or cancels one)",
    },
  };
}
