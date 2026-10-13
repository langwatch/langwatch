// dev/nx/haven-plugin.mjs, bound to specs/setup/haven-nx.feature.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { postTasksExecution, preTasksExecution, rowsFor, runIdFor } from "../haven-plugin.mjs";

const task = ({ project, target, startTime, endTime }) => ({
  id: `${project}:${target}`,
  target: { project, target },
  startTime,
  endTime,
});

describe("haven Nx plugin", () => {
  /** @scenario "Every task in an Nx run carries the run id and worktree" */
  it("gives every task a time-first run id and the worktree", () => {
    const env = preTasksExecution(undefined, { id: "123456789012345", workspaceRoot: "/w/a" });
    assert.equal(env.HAVEN_NX_WORKTREE, "/w/a");
    assert.match(env.HAVEN_NX_RUN, /^[0-9a-z]{9}-123456789012$/);
    const earlier = runIdFor({ nxRunId: "9", now: 1_700_000_000_000 });
    const later = runIdFor({ nxRunId: "1", now: 1_700_000_000_001 });
    assert.ok(earlier < later);
  });

  /** @scenario "An Nx run leaves one history row per task" */
  it("builds one row per task and marks cache hits", () => {
    const rows = rowsFor({
      runId: "r1",
      worktree: "/w/a",
      startTime: 1_000,
      taskResults: {
        "@langwatch/time:typecheck": {
          task: task({
            project: "@langwatch/time",
            target: "typecheck",
            startTime: 1_000,
            endTime: 3_500,
          }),
          status: "success",
          code: 0,
        },
        "@langwatch/handled-error:test": {
          task: task({ project: "@langwatch/handled-error", target: "test" }),
          status: "local-cache",
          code: 0,
        },
      },
    });
    assert.deepEqual(rows, [
      {
        kind: "typecheck",
        project: "@langwatch/time",
        target: "typecheck",
        status: "success",
        exitCode: 0,
        startedAt: new Date(1_000).toISOString(),
        durationMs: 2_500,
        cacheHit: false,
        runId: "r1",
        worktree: "/w/a",
      },
      {
        kind: "test",
        project: "@langwatch/handled-error",
        target: "test",
        status: "local-cache",
        exitCode: 0,
        startedAt: new Date(1_000).toISOString(),
        durationMs: 0,
        cacheHit: true,
        runId: "r1",
        worktree: "/w/a",
      },
    ]);
  });

  /** @scenario "An Nx run never fails because haven is missing" */
  it("stays silent and returns when haven is not on PATH", () => {
    const path = process.env.PATH;
    const logged = [];
    const error = console.error;
    process.env.PATH = "/nonexistent";
    console.error = (line) => logged.push(line);
    try {
      postTasksExecution(undefined, {
        id: "x",
        workspaceRoot: "/w/a",
        startTime: 1_000,
        taskResults: {
          "a:lint": { task: task({ project: "a", target: "lint" }), status: "failure", code: 1 },
        },
      });
    } finally {
      process.env.PATH = path;
      console.error = error;
    }
    assert.deepEqual(logged, []);
  });
});
