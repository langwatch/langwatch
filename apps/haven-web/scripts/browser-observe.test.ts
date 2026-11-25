import assert from "node:assert/strict";
import { test } from "node:test";

import {
  consoleLine,
  diffSnapshots,
  netLine,
  pickConsole,
  pickNet,
  pushRing,
  redactBody,
  summariseTrace,
  type NetEntry,
  type TraceEvent,
} from "./browser-observe.ts";

const before = [
  "- main [ref=e1]:",
  '  - heading "Members" [ref=e2]',
  '  - button "Invite" [ref=e3] [cursor=pointer]',
  '  - text: "3 members"',
].join("\n");

void test("an unchanged page diffs to nothing", () => {
  assert.deepEqual(diffSnapshots({ before, after: before }), []);
});

void test("a dialog opening is added nodes; a renamed ref is one change", () => {
  const after = [
    "- main [ref=e1]:",
    '  - heading "Members" [ref=e2]',
    '  - button "Invite (1)" [ref=e3] [cursor=pointer]',
    '  - dialog "Invite member" [ref=e9]:',
    '    - textbox "Email" [ref=e10]',
  ].join("\n");
  assert.deepEqual(diffSnapshots({ before, after }), [
    '~ button "Invite" [cursor=pointer] -> button "Invite (1)" [ref=e3] [cursor=pointer]',
    '+ dialog "Invite member" [ref=e9]:',
    '+ textbox "Email" [ref=e10]',
    '- text: "3 members"',
  ]);
});

void test("a long diff is cut with a footer", () => {
  const after = Array.from({ length: 50 }, (_, i) => `- row "r${i}" [ref=e${100 + i}]`).join("\n");
  const lines = diffSnapshots({ before: "", after, maxLines: 10 });
  assert.equal(lines.length, 11);
  assert.match(lines[10] ?? "", /40 more change/);
});

const entries: NetEntry[] = [
  {
    id: 1,
    method: "GET",
    url: "https://app.x.localhost:1355/",
    type: "document",
    start: 0,
    status: 200,
    ms: 40,
  },
  {
    id: 2,
    method: "GET",
    url: "https://app.x.localhost:1355/a.js",
    type: "script",
    start: 0,
    status: 200,
    ms: 5,
  },
  {
    id: 3,
    method: "POST",
    url: "https://app.x.localhost:1355/api/trpc/team.list?batch=1",
    type: "fetch",
    start: 0,
    status: 500,
    ms: 812.4,
  },
  {
    id: 4,
    method: "GET",
    url: "https://cdn.example.com/f.woff2",
    type: "font",
    start: 0,
    failed: "net::ERR_ABORTED",
  },
];

void test("a request line is method, path, status and ms", () => {
  assert.equal(
    netLine({ entry: entries[2]!, appHost: "app.x.localhost:1355" }),
    "#3 POST /api/trpc/team.list?batch=1 500 812ms",
  );
  assert.equal(
    netLine({ entry: entries[3]!, appHost: "app.x.localhost:1355" }),
    "#4 GET cdn.example.com/f.woff2 failed net::ERR_ABORTED",
  );
});

void test("network leaves statics out unless they failed, and honours cursor, grep and failed", () => {
  assert.deepEqual(
    pickNet({ entries }).map((e) => e.id),
    [1, 3, 4],
  );
  assert.deepEqual(
    pickNet({ entries, all: true }).map((e) => e.id),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    pickNet({ entries, after: 1, failed: true }).map((e) => e.id),
    [3, 4],
  );
  assert.deepEqual(
    pickNet({ entries, grep: "TRPC" }).map((e) => e.id),
    [3],
  );
});

void test("console keeps a level and above", () => {
  const logs = [
    { id: 1, level: "log", text: "hello" },
    { id: 2, level: "warning", text: "careful" },
    { id: 3, level: "error", text: "boom\n  at x", where: "app.js:3" },
  ];
  assert.deepEqual(
    pickConsole({ entries: logs, level: "error" }).map((e) => e.id),
    [3],
  );
  assert.deepEqual(
    pickConsole({ entries: logs, level: "warn" }).map((e) => e.id),
    [2, 3],
  );
  assert.equal(consoleLine({ entry: logs[2]! }), "[error] boom at x (app.js:3)");
});

void test("bodies hide secret-named fields, JSON or form", () => {
  assert.equal(
    redactBody({
      text: JSON.stringify({ json: { email: "a@b.c", password: "hunter2", apiKey: "k" } }),
    }),
    '{"json":{"email":"a@b.c","password":"<redacted>","apiKey":"<redacted>"}}',
  );
  assert.equal(
    redactBody({ text: "email=a%40b.c&password=hunter2" }),
    "email=a%40b.c&password=<redacted>",
  );
  assert.equal(redactBody({ text: "x".repeat(10), max: 5 }), "xxxx…");
});

void test("a trace summary names long tasks and main-thread time", () => {
  const events: TraceEvent[] = [
    { name: "thread_name", ph: "M", ts: 0, pid: 1, tid: 7, args: { name: "CrRendererMain" } },
    { name: "RunTask", ph: "X", ts: 1_000, dur: 120_000, pid: 1, tid: 7 },
    { name: "FunctionCall", ph: "X", ts: 2_000, dur: 90_000, pid: 1, tid: 7 },
    { name: "FunctionCall", ph: "X", ts: 3_000, dur: 10_000, pid: 1, tid: 7 },
    { name: "Layout", ph: "X", ts: 100_000, dur: 15_000, pid: 1, tid: 7 },
    { name: "RunTask", ph: "X", ts: 1_000, dur: 900_000, pid: 2, tid: 1 },
  ];
  const lines = summariseTrace({ events, requests: entries, appHost: "app.x.localhost:1355" });
  assert.equal(lines[1], "long tasks (>=50 ms): 1, total 120 ms, longest 120 ms");
  assert.equal(lines[2], "scripting: 90 ms · layout: 15 ms · paint: 0 ms");
  assert.equal(lines[4], "  #3 POST /api/trpc/team.list?batch=1 500 812ms");
});

void test("a ring keeps the newest", () => {
  const list = [1, 2, 3];
  pushRing({ list, item: 4, cap: 3 });
  assert.deepEqual(list, [2, 3, 4]);
});
