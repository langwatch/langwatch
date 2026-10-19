import { describe, expect, it } from "vitest";

import type { HttpAnswer, LangWatchHttp } from "./http.ts";
import {
  agentsSinceSetup,
  makeTag,
  parseSeed,
  readResourceFacts,
  setupResourcesWorld,
  taggedItems,
  teardownResourcesWorld,
  type ResourcesWorldState,
} from "./resources-world.ts";
import { parseWorld } from "./world-names.ts";

const TAG = "e2eab12cd";

/**
 * A fake public API: GET serves the rows by path (or the status set for it), POST answers a new
 * id per call, DELETE answers the status set for that path.
 */
function fakeHttp({
  rows,
  deleteStatus = {},
  getStatus = {},
}: {
  rows: Record<string, unknown>;
  deleteStatus?: Record<string, number>;
  getStatus?: Record<string, number>;
}) {
  const deletes: string[] = [];
  const posts: { path: string; body: unknown }[] = [];
  const http: LangWatchHttp = {
    projectId: "p1",
    async request<T>({ method, path, body }: { method: string; path: string; body?: unknown }) {
      if (method === "DELETE") {
        deletes.push(path);
        const status = deleteStatus[path] ?? 200;
        return { status, body: {} as T, text: "" } satisfies HttpAnswer<T>;
      }
      if (method === "POST") {
        posts.push({ path, body });
        return { status: 200, body: { id: `new-${posts.length}` } as T, text: "" };
      }
      return { status: getStatus[path] ?? 200, body: (rows[path] ?? []) as T, text: "" };
    },
  };
  return { http, deletes, posts };
}

const state: ResourcesWorldState = {
  world: "resources",
  tag: TAG,
  setup_at: "2026-10-19T10:00:00.000Z",
  agent_ids_at_setup: ["agent-old"],
  seed: "none",
};

const projectRows = {
  "/api/dataset?limit=1000": {
    data: [
      { id: "ds-1", name: `langy-rows-${TAG}`, recordCount: 3 },
      { id: "ds-2", name: "someone-elses-dataset", recordCount: 9 },
    ],
  },
  "/api/evaluators": [
    { id: "ev-1", name: `langy-eval-${TAG.toUpperCase()}` },
    { id: "ev-2", name: "Hallucination check" },
    { id: "ev-3", name: "kept-by-another-run" },
  ],
  "/api/scenarios": [{ id: "sc-1", name: "unrelated" }],
  "/api/monitors": [
    { id: "mo-1", name: `langy-monitor-${TAG}`, evaluatorId: "ev-2" },
    { id: "mo-2", name: "other-monitor", evaluatorId: "ev-3" },
  ],
  "/api/prompts": [
    { id: "pr-1", handle: `langy-prompt-${TAG}`, name: "Langy prompt" },
    { id: "pr-2", handle: null, name: "untagged" },
  ],
  "/api/dashboards": { data: [{ id: "db-1", name: `langy-dash-${TAG}` }] },
  "/api/triggers": [],
  "/api/v1/agents?limit=1000": {
    data: [
      { id: "agent-old", name: "existing", createdAt: "2026-10-01T00:00:00.000Z" },
      { id: "agent-new", name: "made-elsewhere", createdAt: "2026-10-19T10:05:00.000Z" },
    ],
  },
};

describe("makeTag", () => {
  it("is e2e and six lowercase hex digits, with no separator a slug could drop", () => {
    expect(makeTag({ uuid: "AB12CDEF-0000-0000-0000-000000000000" })).toBe("e2eab12cd");
    expect(makeTag()).toMatch(/^e2e[0-9a-f]{6}$/);
  });

  it("differs per run", () => {
    expect(makeTag()).not.toBe(makeTag());
  });
});

describe("the world parameter", () => {
  it("names the resources world", () => {
    expect(parseWorld({ value: "resources" })).toBe("resources");
  });
});

describe("taggedItems", () => {
  it("keeps only rows whose name holds the tag, ignoring case", () => {
    const rows = projectRows["/api/evaluators"];
    expect(taggedItems({ rows, tag: TAG })).toEqual([
      { id: "ev-1", name: `langy-eval-${TAG.toUpperCase()}` },
    ]);
  });

  it("names a prompt by its handle and carries a dataset's record count", () => {
    expect(taggedItems({ rows: projectRows["/api/prompts"], tag: TAG })).toEqual([
      { id: "pr-1", name: `langy-prompt-${TAG}` },
    ]);
    expect(taggedItems({ rows: projectRows["/api/dataset?limit=1000"].data, tag: TAG })).toEqual([
      { id: "ds-1", name: `langy-rows-${TAG}`, recordCount: 3 },
    ]);
  });
});

describe("agentsSinceSetup", () => {
  it("lists agents missing from the setup snapshot and created after setup", () => {
    const rows = [
      ...projectRows["/api/v1/agents?limit=1000"].data,
      { id: "agent-before", name: "older", createdAt: "2026-10-19T09:00:00.000Z" },
    ];
    expect(agentsSinceSetup({ rows, state })).toEqual([
      { id: "agent-new", name: "made-elsewhere" },
    ]);
  });
});

describe("setupResourcesWorld", () => {
  it("puts the tag, the setup time and the agent snapshot in the state", async () => {
    const { http } = fakeHttp({ rows: projectRows });
    const made = await setupResourcesWorld({
      http,
      now: () => new Date("2026-10-19T10:00:00.000Z"),
    });
    expect(made).toEqual({
      world: "resources",
      tag: expect.stringMatching(/^e2e[0-9a-f]{6}$/),
      setup_at: "2026-10-19T10:00:00.000Z",
      agent_ids_at_setup: ["agent-old", "agent-new"],
      seed: "none",
    });
  });
});

describe("readResourceFacts", () => {
  it("lists the tagged items of every kind, and nothing untagged", async () => {
    const { http } = fakeHttp({ rows: projectRows });
    const facts = await readResourceFacts({ http, state });
    expect(facts).toEqual({
      new_dataset: [{ id: "ds-1", name: `langy-rows-${TAG}`, recordCount: 3 }],
      new_evaluator: [{ id: "ev-1", name: `langy-eval-${TAG.toUpperCase()}` }],
      new_scenario: [],
      new_monitor: [{ id: "mo-1", name: `langy-monitor-${TAG}` }],
      new_prompt: [{ id: "pr-1", name: `langy-prompt-${TAG}` }],
      new_dashboard: [{ id: "db-1", name: `langy-dash-${TAG}` }],
      new_trigger: [],
      new_agent: [],
      agents_since_setup: [{ id: "agent-new", name: "made-elsewhere" }],
    });
  });
});

describe("teardownResourcesWorld", () => {
  it("deletes only tagged items and the evaluator a tagged monitor runs, monitors first", async () => {
    const { http, deletes } = fakeHttp({ rows: projectRows });
    const result = await teardownResourcesWorld({ http, state });
    expect(deletes[0]).toBe("/api/monitors/mo-1");
    expect(deletes.toSorted()).toEqual([
      "/api/dashboards/db-1",
      "/api/dataset/ds-1",
      "/api/evaluators/ev-1",
      "/api/evaluators/ev-2",
      "/api/monitors/mo-1",
      "/api/prompts/pr-1",
    ]);
    expect(result.deleted.evaluator).toEqual([
      `langy-eval-${TAG.toUpperCase()}`,
      "Hallucination check",
    ]);
    expect(result.left_behind.items).toEqual([]);
  });

  it("counts a 404 as gone and reports any other failure as left behind", async () => {
    const { http } = fakeHttp({
      rows: projectRows,
      deleteStatus: { "/api/dataset/ds-1": 404, "/api/dashboards/db-1": 500 },
    });
    const result = await teardownResourcesWorld({ http, state });
    expect(result.deleted.dataset).toEqual([`langy-rows-${TAG}`]);
    expect(result.left_behind.items).toEqual([`dashboard langy-dash-${TAG} (db-1): HTTP 500`]);
  });

  it("returns the final facts it read before deleting", async () => {
    const { http } = fakeHttp({ rows: projectRows });
    const result = await teardownResourcesWorld({ http, state });
    expect(result.final_facts.new_monitor).toEqual([{ id: "mo-1", name: `langy-monitor-${TAG}` }]);
  });
});

describe("parseSeed", () => {
  it("reads an empty value as none and refuses an unknown seed", () => {
    expect(parseSeed({ value: "" })).toBe("none");
    expect(parseSeed({ value: " evaluator_pair " })).toBe("evaluator_pair");
    expect(() => parseSeed({ value: "everything" })).toThrow(/unknown seed "everything"/);
  });
});

describe("the seeds", () => {
  const NOW = new Date("2026-10-19T10:00:00.000Z");
  const seeded = async ({
    seed,
    searchDeadlineMs,
  }: {
    seed: ResourcesWorldState["seed"];
    searchDeadlineMs?: number;
  }) => {
    const fake = fakeHttp({ rows: projectRows });
    const made = await setupResourcesWorld({
      http: fake.http,
      seed,
      now: () => NOW,
      searchDeadlineMs,
    });
    return { made, posts: fake.posts };
  };

  it("evaluator_pair makes a tagged target and a tagged bystander exact-match evaluator", async () => {
    const { made, posts } = await seeded({ seed: "evaluator_pair" });
    expect(made).toMatchObject({
      seed: "evaluator_pair",
      evaluator_id: "new-1",
      evaluator_name: `langy-delete-me-${made.tag}`,
      bystander_id: "new-2",
      bystander_name: `langy-keep-me-${made.tag}`,
    });
    expect(posts).toEqual([
      {
        path: "/api/evaluators",
        body: {
          name: `langy-delete-me-${made.tag}`,
          config: { evaluatorType: "langevals/exact_match" },
        },
      },
      {
        path: "/api/evaluators",
        body: {
          name: `langy-keep-me-${made.tag}`,
          config: { evaluatorType: "langevals/exact_match" },
        },
      },
    ]);
  });

  it("evaluator makes one tagged evaluator to rename", async () => {
    const { made } = await seeded({ seed: "evaluator" });
    expect(made).toMatchObject({
      evaluator_id: "new-1",
      evaluator_name: `langy-rename-me-${made.tag}`,
    });
  });

  it("prompt makes a tagged prompt to run a scenario against", async () => {
    const { made, posts } = await seeded({ seed: "prompt" });
    expect(made).toMatchObject({
      prompt_id: "new-1",
      prompt_handle: `langy-greeting-target-${made.tag}`,
    });
    expect(posts[0]?.path).toBe("/api/prompts");
  });

  it("trace sends one tagged trace a minute old and waits until it reads back", async () => {
    const { made, posts } = await seeded({ seed: "trace" });
    expect(made.trace_id).toBe(`e2e-${made.tag}-trace`);
    const body = posts[0]?.body as {
      trace_id: string;
      spans: { timestamps: { started_at: number } }[];
    };
    expect(posts[0]?.path).toBe("/api/collector");
    expect(body.trace_id).toBe(made.trace_id);
    expect(body.spans[0]?.timestamps.started_at).toBe(NOW.getTime() - 60_000);
  });

  it("stale_traces sends 3 traces about 8 hours old under a tagged label", async () => {
    const { made, posts } = await seeded({ seed: "stale_traces" });
    expect(made.stale_label).toBe(`e2e-stale-${made.tag}`);
    expect(made.stale_trace_ids).toHaveLength(3);
    const eightHours = 8 * 60 * 60 * 1000;
    for (const post of posts) {
      const body = post.body as {
        spans: { timestamps: { started_at: number } }[];
        metadata: { labels: string[] };
      };
      expect(body.metadata.labels).toEqual([made.stale_label]);
      expect(NOW.getTime() - (body.spans[0]?.timestamps.started_at ?? 0)).toBeGreaterThanOrEqual(
        eightHours,
      );
    }
  });

  it("refuses setup when the seeded traces never read back, so the run is not scored", async () => {
    await expect(seeded({ seed: "trace", searchDeadlineMs: 0 })).rejects.toThrow(/not searchable/);
  });
});

describe("the seed facts", () => {
  it("evaluator_pair says whether the target and the bystander still exist", async () => {
    const { http } = fakeHttp({ rows: projectRows });
    const facts = await readResourceFacts({
      http,
      state: { ...state, seed: "evaluator_pair", evaluator_id: "ev-gone", bystander_id: "ev-3" },
    });
    expect(facts).toMatchObject({ target_exists: false, bystander_exists: true });
  });

  it("evaluator shows the seeded evaluator's current name, found by id", async () => {
    const { http } = fakeHttp({ rows: projectRows });
    const facts = await readResourceFacts({
      http,
      state: { ...state, seed: "evaluator", evaluator_id: "ev-1" },
    });
    expect(facts.seeded_evaluator).toEqual({ id: "ev-1", name: `langy-eval-${TAG.toUpperCase()}` });
  });

  it("trace lists the annotations on the seeded trace", async () => {
    const { http } = fakeHttp({
      rows: {
        ...projectRows,
        "/api/annotations/trace/tr-1": {
          data: [{ id: "an-1", comment: "looks correct", isThumbsUp: true, traceId: "tr-1" }],
        },
      },
    });
    const facts = await readResourceFacts({
      http,
      state: { ...state, seed: "trace", trace_id: "tr-1" },
    });
    expect(facts.trace_annotations).toEqual([
      { id: "an-1", comment: "looks correct", isThumbsUp: true },
    ]);
  });

  it("prompt counts the runs of a tagged scenario, or null when the listing is refused", async () => {
    const rows = {
      ...projectRows,
      "/api/scenarios": [{ id: "sc-1", name: `langy-greeting-check-${TAG}` }],
      "/api/simulation-runs?limit=100": {
        runs: [{ scenarioId: "sc-1" }, { scenarioId: "sc-other" }, { scenarioId: "sc-1" }],
      },
    };
    const promptState = { ...state, seed: "prompt" as const, prompt_id: "pr-1" };
    const read = await readResourceFacts({ http: fakeHttp({ rows }).http, state: promptState });
    expect(read.runs_of_new_scenario).toBe(2);
    const refused = fakeHttp({ rows, getStatus: { "/api/simulation-runs?limit=100": 403 } });
    expect(
      (await readResourceFacts({ http: refused.http, state: promptState })).runs_of_new_scenario,
    ).toBeNull();
  });

  it("adds no seed facts without a seed", async () => {
    const { http } = fakeHttp({ rows: projectRows });
    const facts = await readResourceFacts({ http, state });
    expect(Object.keys(facts).filter((key) => !key.startsWith("new_"))).toEqual([
      "agents_since_setup",
    ]);
  });
});

describe("teardown of seeded items", () => {
  it("deletes every seeded evaluator, tagged or not, once each", async () => {
    const { http, deletes } = fakeHttp({ rows: projectRows });
    await teardownResourcesWorld({
      http,
      state: { ...state, seed: "evaluator_pair", evaluator_id: "ev-1", bystander_id: "ev-3" },
    });
    expect(deletes).toContain("/api/evaluators/ev-1");
    expect(deletes).toContain("/api/evaluators/ev-3");
    expect(deletes.filter((path) => path === "/api/evaluators/ev-1")).toHaveLength(1);
  });

  it("counts an already deleted seed as gone", async () => {
    const { http } = fakeHttp({
      rows: projectRows,
      deleteStatus: { "/api/evaluators/ev-gone": 404 },
    });
    const result = await teardownResourcesWorld({
      http,
      state: { ...state, seed: "evaluator", evaluator_id: "ev-gone", evaluator_name: "langy-x" },
    });
    expect(result.deleted.evaluator).toContain("langy-x");
    expect(result.left_behind.items).toEqual([]);
  });

  it("deletes the annotations on a seeded trace and reports the trace left behind", async () => {
    const { http, deletes } = fakeHttp({
      rows: {
        ...projectRows,
        "/api/annotations/trace/tr-1": { data: [{ id: "an-1", comment: "looks correct" }] },
      },
    });
    const result = await teardownResourcesWorld({
      http,
      state: { ...state, seed: "trace", trace_id: "tr-1" },
    });
    expect(deletes).toContain("/api/annotations/an-1");
    expect(result.deleted.annotation).toEqual(["looks correct"]);
    expect(result.left_behind).toMatchObject({ traces: ["tr-1"], why: "no trace delete route" });
  });

  it("reports stale traces as left behind", async () => {
    const { http } = fakeHttp({ rows: projectRows });
    const result = await teardownResourcesWorld({
      http,
      state: { ...state, seed: "stale_traces", stale_trace_ids: ["st-0", "st-1", "st-2"] },
    });
    expect(result.left_behind).toMatchObject({ traces: ["st-0", "st-1", "st-2"] });
  });
});
