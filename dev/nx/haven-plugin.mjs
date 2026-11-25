import { spawnSync } from "node:child_process";

// Ties an Nx run to haven (dev/docs/plans/haven-exec-policy.md, phase 6): every task gets the
// run id and worktree in its environment, and after the run one row per task goes to haven's
// run history through `haven machine history add`. Nx cannot take a slot per task; the
// launchers do. A missing haven is silent; a failing one logs one line; neither fails the run.
const cacheStatuses = new Set(["local-cache", "local-cache-kept-existing", "remote-cache"]);

// Time first (base36 milliseconds, fixed width) so ids sort by start; Nx's own run id after it.
export const runIdFor = ({ nxRunId, now }) =>
  `${now.toString(36).padStart(9, "0")}-${String(nxRunId).slice(0, 12)}`;

// The same five buckets haven files a run's history under (domain.HistoryKind).
export const kindOf = (target) => {
  if (/typecheck|tsc/.test(target)) return "typecheck";
  if (target.startsWith("format")) return "format";
  if (target.startsWith("lint")) return "lint";
  if (target.startsWith("test")) return "test";
  return "other";
};

export const rowsFor = ({ taskResults, runId, worktree, startTime }) =>
  Object.values(taskResults).map(({ task, status, code }) => {
    const started = task.startTime ?? startTime;
    return {
      kind: kindOf(task.target.target),
      project: task.target.project,
      target: task.target.target,
      status,
      exitCode: code,
      startedAt: new Date(started).toISOString(),
      durationMs: task.endTime && task.startTime ? task.endTime - task.startTime : 0,
      cacheHit: cacheStatuses.has(status),
      runId,
      worktree,
    };
  });

// Pre and post run in the same process (the daemon, or the CLI without one) and share Nx's id.
const runIds = new Map();

export const preTasksExecution = (_options, { id, workspaceRoot }) => {
  const runId = runIdFor({ nxRunId: id, now: Date.now() });
  runIds.set(id, runId);
  return { HAVEN_NX_RUN: runId, HAVEN_NX_WORKTREE: workspaceRoot };
};

export const postTasksExecution = (_options, { id, workspaceRoot, taskResults, startTime }) => {
  const runId = runIds.get(id) ?? runIdFor({ nxRunId: id, now: startTime });
  runIds.delete(id);
  const rows = rowsFor({ taskResults, runId, worktree: workspaceRoot, startTime });
  if (rows.length === 0) return;
  const input = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const result = spawnSync("haven", ["machine", "history", "add"], {
    input,
    timeout: 3000,
    stdio: ["pipe", "ignore", "pipe"],
  });
  if (result.error?.code === "ENOENT") return;
  if (result.error || result.status !== 0) {
    const why =
      result.error?.message ??
      (String(result.stderr).trim().split("\n")[0] || `exit ${result.status}`);
    console.error(`haven-plugin: Nx task history not recorded (${why})`);
  }
};
