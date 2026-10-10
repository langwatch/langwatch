import assert from "node:assert/strict";
import { test } from "node:test";

import { missingQuery, queriesOf, specOf } from "./browser-record.ts";

const appHost = "app.test";

test("a tRPC batch is one query per procedure and telemetry is dropped", () => {
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

test("a recorded query must come back with the same status", () => {
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

test("locators prefer role and name, then label, and never a ref", () => {
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
