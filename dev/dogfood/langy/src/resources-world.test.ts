import { describe, expect, it } from "vitest";

import type { HttpAnswer, LangWatchHttp } from "./http.ts";
import {
  agentsSinceSetup,
  makeTag,
  readResourceFacts,
  setupResourcesWorld,
  taggedItems,
  teardownResourcesWorld,
  type ResourcesWorldState,
} from "./resources-world.ts";
import { parseWorld } from "./world-names.ts";

const TAG = "e2eab12cd";

/** A fake public API: GET serves the rows by path, DELETE answers the status set for that path. */
function fakeHttp({
  rows,
  deleteStatus = {},
}: {
  rows: Record<string, unknown>;
  deleteStatus?: Record<string, number>;
}) {
  const deletes: string[] = [];
  const http: LangWatchHttp = {
    projectId: "p1",
    async request<T>({ method, path }: { method: string; path: string }) {
      if (method === "DELETE") {
        deletes.push(path);
        const status = deleteStatus[path] ?? 200;
        return { status, body: {} as T, text: "" } satisfies HttpAnswer<T>;
      }
      return { status: 200, body: (rows[path] ?? []) as T, text: "" };
    },
  };
  return { http, deletes };
}

const state: ResourcesWorldState = {
  world: "resources",
  tag: TAG,
  setup_at: "2026-10-19T10:00:00.000Z",
  agent_ids_at_setup: ["agent-old"],
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
    expect([...deletes].sort()).toEqual([
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
