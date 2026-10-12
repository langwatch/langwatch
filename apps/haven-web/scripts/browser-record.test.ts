import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WALK_CAP,
  missingQuery,
  pushWalk,
  queriesOf,
  settleWalk,
  specOf,
  type Walk,
} from "./browser-record.ts";

const appHost = "app.test";

void test("a tRPC batch is one query per procedure and telemetry is dropped", () => {
  const url = "https://app.test/api/trpc/project.list,team.get?batch=1";
  assert.deepEqual(queriesOf({ method: "GET", url, status: 200, appHost }), [
    { method: "GET", path: "trpc:project.list", status: 200 },
    { method: "GET", path: "trpc:team.get", status: 200 },
  ]);
  assert.deepEqual(
    queriesOf({ method: "POST", url: "https://app.test/api/otel/v1/traces", status: 200, appHost }),
    [],
  );
  assert.deepEqual(
    queriesOf({ method: "GET", url: "https://cdn.test/api/x", status: 200, appHost }),
    [],
  );
});

void test("a recorded query must come back with the same status", () => {
  const expected = [{ method: "GET", path: "/api/a", status: 200 }];
  assert.equal(
    missingQuery({ expected, got: [{ method: "GET", path: "/api/a", status: 200 }] }),
    undefined,
  );
  assert.deepEqual(
    missingQuery({ expected, got: [{ method: "GET", path: "/api/a", status: 500 }] }),
    expected[0],
  );
});

void test("locators prefer role and name, then label, and never a ref", () => {
  const base = {
    tag: "x",
    role: "",
    name: "",
    label: "",
    testid: "",
    placeholder: "",
    text: "",
    id: "",
    secret: false,
  };
  assert.deepEqual(specOf({ ...base, role: "button", name: "Save" }), {
    by: "role",
    value: "button",
    name: "Save",
  });
  assert.deepEqual(specOf({ ...base, label: "Email" }), { by: "label", value: "Email" });
  assert.equal(specOf(base), undefined);
});

void test("a walk keeps its newest steps and starts where the dropped ones left the page", () => {
  const walk: Walk = { script: { version: 1, steps: [] } };
  for (let i = 0; i < WALK_CAP + 2; i++) {
    const seen = [{ method: "GET", path: `/api/${i}`, status: 200 }];
    pushWalk({
      walk,
      step: { verb: "goto", url: `/p${i}`, expect: { url: "", queries: [] } },
      seen,
    });
    seen.push({ method: "GET", path: `/api/${i}`, status: 200 });
    settleWalk({ walk, url: `/p${i}` });
  }
  assert.equal(walk.script.steps.length, WALK_CAP);
  assert.equal(walk.script.startUrl, "/p1");
  assert.deepEqual(walk.script.steps[0]?.expect, {
    url: "/p2",
    queries: [{ method: "GET", path: "/api/2", status: 200 }],
  });
});

void test("a walk's last step takes the queries that arrive after it, until it is settled", () => {
  const walk: Walk = { script: { version: 1, steps: [] } };
  const seen: { method: string; path: string; status: number }[] = [];
  pushWalk({
    walk,
    step: { verb: "press", key: "Enter", expect: { url: "/a", queries: [] } },
    seen,
  });
  seen.push({ method: "POST", path: "trpc:team.create", status: 200 });
  settleWalk({ walk, url: "/b" });
  settleWalk({ walk, url: "/c" });
  assert.deepEqual(walk.script.steps[0]?.expect, {
    url: "/b",
    queries: [{ method: "POST", path: "trpc:team.create", status: 200 }],
  });
});
