import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeType,
  parseDiagnostics,
  parseTraceLine,
  scanTypes,
  summariseTrace,
} from "../ts-program-metrics.mjs";

const root = "/work/repo";

void describe("tsgo's extended diagnostics", () => {
  /** @scenario "The compiler's extended diagnostics are read per program" */
  void it("reads symbols, types, instantiations, memory and check time", () => {
    const row = parseDiagnostics({
      output: [
        "Files:              64",
        "Symbols:         55079",
        "Types:           31876",
        "Instantiations:  28140",
        "Memory used:    62595K",
        "Check time:     0.127s",
      ].join("\n"),
    });
    assert.deepEqual(row, {
      files: 64,
      symbols: 55079,
      types: 31876,
      instantiations: 28140,
      memoryUsed: 62595,
      checkTime: 0.127,
    });
  });
});

void describe("tsgo's trace", () => {
  const events = [
    { ph: "B", tid: 5, ts: 0, name: "checkSourceFile", args: { path: "/work/repo/src/slow.ts" } },
    {
      ph: "E",
      tid: 5,
      ts: 900_000,
      name: "checkSourceFile",
      args: { path: "/work/repo/src/slow.ts" },
    },
    { ph: "B", tid: 6, ts: 0, name: "checkSourceFile", args: { path: "/work/repo/src/quick.ts" } },
    {
      ph: "E",
      tid: 6,
      ts: 1_000,
      name: "checkSourceFile",
      args: { path: "/work/repo/src/quick.ts" },
    },
    // A relation inside another on the same thread is part of the outer one's cost.
    {
      ph: "X",
      tid: 2,
      ts: 100,
      dur: 400_000,
      name: "structuredTypeRelatedTo",
      args: { checkerId: 1, sourceId: 7, targetId: 8 },
    },
    {
      ph: "X",
      tid: 2,
      ts: 200,
      dur: 300_000,
      name: "structuredTypeRelatedTo",
      args: { checkerId: 1, sourceId: 9, targetId: 10 },
    },
    {
      ph: "X",
      tid: 3,
      ts: 0,
      dur: 50_000,
      name: "structuredTypeRelatedTo",
      args: { checkerId: 2, sourceId: 1, targetId: 2 },
    },
  ];

  /** @scenario "The trace is summarised into the slowest files and type relations" */
  void it("pairs begin and end events and keeps only the outermost relations, slowest first", () => {
    const summary = summariseTrace({ events, root });
    assert.deepEqual(summary.hotFiles, [
      ["src/slow.ts", 900],
      ["src/quick.ts", 1],
    ]);
    assert.deepEqual(
      summary.hotRelations.map((relation) => [relation.checker, relation.sourceId, relation.ms]),
      [
        [1, 7, 400],
        [2, 1, 50],
      ],
    );
  });

  void it("reads one event per line and skips the array brackets", () => {
    assert.equal(parseTraceLine({ line: "[" }), null);
    assert.equal(parseTraceLine({ line: '{"ph":"B","name":"x"},' }).name, "x");
  });

  void it("resolves the types a relation names, and counts our own generics", async () => {
    const generics = {};
    const found = await scanTypes({
      lines: [
        '[{"id":1,"intrinsicName":"any","flags":["Any"]},',
        '{"id":7,"symbolName":"Router","aliasTypeArguments":[1],"firstDeclaration":{"path":"/work/repo/src/router.ts","start":{"line":3,"character":1}},"display":"Router<any>"},',
        '{"id":9,"symbolName":"Array","typeArguments":[1],"firstDeclaration":{"path":"/work/repo/node_modules/lib.d.ts","start":{"line":1,"character":1}}}]',
      ],
      wanted: new Set([7]),
      root,
      generics,
    });
    assert.equal(describeType({ type: found.get(7), root }), "Router<any> (src/router.ts:3)");
    assert.deepEqual(generics, { "Router src/router.ts": 1 });
  });
});
