// The Node half of the shared dev log format
// (dev/docs/best_practices/dev-log-format.md). The Go half is
// tools/thuishaven/domain/logfmt; both assert against the SAME fixture.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { LANE_WIDTH, LEVEL_WIDTH, normalizeLevel, render, resolveColor } from "../log-render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");

/** The capture instant the fixture's non-JSON lines are rendered at. */
const fixtureTime = new Date("2026-09-07T11:10:51.000Z");

function readFixture(name) {
  return readFileSync(join(fixtures, name), "utf8");
}

void describe("given the shared log-format fixture", () => {
  void it("renders byte for byte what the Go renderer renders", () => {
    assert.equal(
      process.env.TZ,
      "UTC",
      "run this suite with TZ=UTC — the time column is local wall time",
    );
    const lines = readFixture("dev-log-lines.jsonl").replace(/\n$/, "").split("\n");
    const got = `${lines.map((line) => render(line, { lane: "api", at: fixtureTime })).join("\n")}\n`;
    assert.equal(got, readFixture("dev-log-lines.expected.txt"));
  });
});

void describe("given a structured line", () => {
  const at = fixtureTime;

  void it("puts the message at the same offset whatever the lane and level", () => {
    const short = render('{"level":"info","msg":"x"}', { lane: "ui", at });
    const long = render('{"level":"error","msg":"x"}', { lane: "storybook", at });
    const offset = (line) => line.indexOf("x");
    assert.equal(offset(short), offset(long));
    assert.equal(offset(short), 12 + 2 + LANE_WIDTH + 2 + LEVEL_WIDTH + 2);
  });

  void it("indents a stack trace under its line", () => {
    const got = render(
      '{"level":"error","msg":"boom","stack":"Error: boom\\n    at run (a.ts:1:1)"}',
      {
        lane: "api",
        at,
      },
    );
    // The header repeats the message, so it is read out once and the frames
    // — what the stack alone adds — are what stays.
    assert.deepEqual(got.split("\n").slice(1), ["        at run (a.ts:1:1)"]);
  });

  void it("insets a message that carries its own newlines", () => {
    const got = render('{"level":"fatal","msg":"rejected: [\\n  {\\n    \\"code\\": \\"bad\\"\\n  }\\n]"}', {
      lane: "worker",
      at,
    });
    for (const row of got.split("\n").slice(1)) {
      assert.ok(row.startsWith("    "), `continuation ${row} must be inset, not at the margin`);
    }
  });

  void it("reads a repeated error out once, keeping the type it named", () => {
    const got = render(
      '{"level":"fatal","msg":"boot failed: the mcp member cannot be supplied","stack":"MissingMemberError: the mcp member cannot be supplied\\n    at build (m.ts:1:1)"}',
      { lane: "worker", at },
    );
    assert.equal(got.split("the mcp member cannot be supplied").length - 1, 1);
    assert.ok(got.includes("error=MissingMemberError"), got);
  });

  void it("drops the fields that are constant for the process", () => {
    const got = render(
      '{"level":"warn","msg":"x","pid":1,"hostname":"box","service":"s","keep":"yes"}',
      {
        lane: "api",
        at,
      },
    );
    assert.match(got, /keep=yes$/);
    assert.doesNotMatch(got, /pid=|hostname=|service=/);
  });
});

void describe("given a line that is not the shared format", () => {
  void it("passes it through under the lane column with a blank level", () => {
    const got = render("exited — restarting in 1s", { lane: "api", at: fixtureTime });
    assert.equal(got, "11:10:51.000  api               exited — restarting in 1s");
  });

  void it("passes another tool's JSON through rather than rendering an empty line", () => {
    const got = render('{"schemaVersion":3,"outputs":[]}', { lane: "api", at: fixtureTime });
    assert.ok(got.endsWith('{"schemaVersion":3,"outputs":[]}'));
  });
});

void describe("given colour settings", () => {
  const line = '{"level":"error","msg":"boom"}';

  void it("paints the lane and the level when colour is on", () => {
    const got = render(line, { lane: "api", laneColor: "35", at: fixtureTime, color: true });
    assert.ok(got.includes("[35mapi"));
    assert.ok(got.includes("[31merror"));
  });

  void it("emits no escape sequences when colour is off", () => {
    const got = render(line, { lane: "api", laneColor: "35", at: fixtureTime });
    assert.doesNotMatch(got, /\[/);
  });

  void it("lets NO_COLOR outrank the lane wrapper's --color", () => {
    assert.equal(resolveColor(["--color"], { NO_COLOR: "1" }, true), false);
    assert.equal(resolveColor(["--color"], {}, false), true);
    assert.equal(resolveColor([], {}, false), false);
    assert.equal(resolveColor(["--no-color"], {}, true), false);
  });
});

void describe("given a level written some other way", () => {
  void it("maps every spelling onto one word", () => {
    assert.equal(normalizeLevel("INFO"), "info");
    assert.equal(normalizeLevel("warning"), "warn");
    assert.equal(normalizeLevel("dpanic"), "error");
    assert.equal(normalizeLevel("chatty"), "");
  });

  void it("reads pino's numeric levels", () => {
    assert.match(render('{"level":50,"msg":"x"}', { lane: "api", at: fixtureTime }), /error/);
  });
});
