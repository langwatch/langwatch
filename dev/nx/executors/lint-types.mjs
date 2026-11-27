import { spawn } from "node:child_process";
import { join } from "node:path";

// The `lint:types` executor. Nx batches every project it did not replay into one
// `dev/nx/lint.mjs --resolved --types` run, so a miss of many projects builds their
// programs once, as the tree run did, and each project still caches its own result.
// The report is split back by the project that owns each file (ADR-150).
const DIAGNOSTIC = /^(\S.*?):\d+:\d+: /;
const PROCESS_FAILED = /^oxlint -c \S+ exited /m;

function lint({ workspaceRoot, roots }) {
  const script = join(workspaceRoot, "dev/nx/lint.mjs");
  const child = spawn(process.execPath, [script, "--resolved", "--types", ...roots], {
    cwd: workspaceRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (err += chunk));

  return new Promise((resolve) => child.on("close", (status) => resolve({ status, out, err })));
}

/** Each root's report lines: a diagnostic and its indented help go to the deepest owning root. */
export function splitReport({ out, roots }) {
  const byRoot = new Map(roots.map((root) => [root, []]));
  const owner = (file) =>
    roots
      .filter((root) => file === root || file.startsWith(`${root}/`))
      .toSorted((a, b) => b.length - a.length)[0];
  let current;
  for (const line of out.split("\n")) {
    const match = DIAGNOSTIC.exec(line);
    if (match) current = owner(match[1]);
    else if (!line.startsWith("  ")) current = undefined;
    if (current) byRoot.get(current).push(line);
  }

  return byRoot;
}

const countOf = (lines) => lines.filter((line) => DIAGNOSTIC.test(line)).length;

/** One result per task; a failed process, or a report the projects do not add up to, fails all. */
export function taskResults({ tasks, roots, status, out, err }) {
  const byRoot = splitReport({ out, roots });
  const attributed = [...byRoot.values()].reduce((sum, lines) => sum + countOf(lines), 0);
  const reported = Number(/^(\d+) problem\(s\)$/m.exec(out)?.[1] ?? Number.NaN);
  const failed =
    PROCESS_FAILED.test(err) || (status !== 0 && (attributed === 0 || attributed !== reported));

  return Object.fromEntries(
    tasks.map((task, i) => {
      const lines = byRoot.get(roots[i]);
      const problems = countOf(lines);
      const report = failed
        ? `${err}${out}`
        : `${lines.map((line) => `${line}\n`).join("")}${problems} problem(s)\n`;
      return [task.id, { success: !failed && problems === 0, terminalOutput: report }];
    }),
  );
}

export async function batch(taskGraph, _inputs, _overrides, context) {
  const tasks = Object.values(taskGraph.tasks);
  const { projects } = context.projectsConfigurations;
  const roots = tasks.map((task) => projects[task.target.project].root);
  const run = await lint({ workspaceRoot: context.root, roots });
  process.stderr.write(run.err);
  process.stdout.write(run.out);

  return taskResults({ tasks, roots, ...run });
}

export async function run(_options, context) {
  const task = { id: context.projectName, target: { project: context.projectName } };
  const results = await batch({ tasks: { [task.id]: task } }, {}, {}, context);

  return { success: results[task.id].success };
}
