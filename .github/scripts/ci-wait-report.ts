// How long pull request CI waits for a runner against how long it works: per
// job by hour of day (UTC), and per workflow as total time against its longest
// job. Baseline for dev/docs/plans/ci-redesign.md.
// Usage: node --experimental-transform-types .github/scripts/ci-wait-report.ts [days]

import { execFileSync } from "node:child_process";

const REPO = "langwatch/langwatch";
const days = Number(process.argv[2] ?? 7);
const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();

type Run = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  run_attempt: number;
};
type Job = {
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  conclusion: string | null;
};

async function get<T>({ path }: { path: string }): Promise<T> {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return (await response.json()) as T;
}

// A busy hour holds 800+ runs, and a week more than an hour's API allowance:
// take PER_HOUR runs from one random full page of every hour (about 1,000
// calls). Only full pages are picked, so a short last page never thins it.
const PER_HOUR = 4;

async function pullRequestRuns(): Promise<Run[]> {
  const runs: Run[] = [];
  const start = Math.floor(Date.now() / 3_600_000) - days * 24;
  for (let hour = start; hour < start + days * 24; hour++) {
    const from = new Date(hour * 3_600_000).toISOString().slice(0, 19);
    const to = new Date((hour + 1) * 3_600_000 - 1000).toISOString().slice(0, 19);
    const query = `repos/${REPO}/actions/runs?event=pull_request&status=completed&created=${from}Z..${to}Z&per_page=100`;
    const first = await get<{ total_count: number; workflow_runs: Run[] }>({ path: query });
    const fullPages = Math.max(1, Math.min(10, Math.floor(first.total_count / 100)));
    const page = 1 + Math.floor(Math.random() * fullPages);
    const { workflow_runs } =
      page === 1 ? first : await get<{ workflow_runs: Run[] }>({ path: `${query}&page=${page}` });
    const firstAttempts = workflow_runs.filter((run) => run.run_attempt === 1);
    const step = Math.max(1, Math.floor(firstAttempts.length / PER_HOUR));
    runs.push(...firstAttempts.filter((_, i) => i % step === 0).slice(0, PER_HOUR));
  }
  return runs;
}

async function withJobs({ runs }: { runs: Run[] }): Promise<{ run: Run; jobs: Job[] }[]> {
  const result: { run: Run; jobs: Job[] }[] = [];
  for (let i = 0; i < runs.length; i += 16) {
    const batch = await Promise.all(
      runs.slice(i, i + 16).map(async (run) => {
        const { jobs } = await get<{ jobs: Job[] }>({
          path: `repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`,
        });
        return {
          run,
          jobs: jobs.filter(
            (job) => job.started_at && job.completed_at && job.conclusion !== "skipped",
          ),
        };
      }),
    );
    result.push(...batch);
  }
  return result;
}

const seconds = ({ from, to }: { from: string; to: string }) =>
  (Date.parse(to) - Date.parse(from)) / 1000;
const percentile = ({ values, p }: { values: number[]; p: number }) =>
  values.length === 0 ? 0 : values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * p)]!;
const minutes = (value: number) => (value / 60).toFixed(1);
const median = (values: number[]) => minutes(percentile({ values, p: 0.5 }));
const p90 = (values: number[]) => minutes(percentile({ values, p: 0.9 }));

const sampled = await withJobs({ runs: await pullRequestRuns() });
const jobs = sampled.flatMap(({ jobs }) => jobs);

const byHour = new Map<number, { waits: number[]; work: number }>();
for (const job of jobs) {
  const hour = new Date(job.created_at).getUTCHours();
  const row = byHour.get(hour) ?? { waits: [], work: 0 };
  row.waits.push(Math.max(0, seconds({ from: job.created_at, to: job.started_at! })));
  row.work += seconds({ from: job.started_at!, to: job.completed_at! });
  byHour.set(hour, row);
}

const byWorkflow = new Map<string, { total: number[]; longestJob: number[] }>();
for (const { run, jobs: runJobs } of sampled) {
  if (runJobs.length === 0) continue;
  const row = byWorkflow.get(run.name) ?? { total: [], longestJob: [] };
  row.total.push(seconds({ from: run.created_at, to: run.updated_at }));
  row.longestJob.push(
    Math.max(...runJobs.map((job) => seconds({ from: job.started_at!, to: job.completed_at! }))),
  );
  byWorkflow.set(run.name, row);
}

const allWaits = [...byHour.values()].flatMap((row) => row.waits);
console.log(
  `Pull request CI, last ${days} days, ${PER_HOUR} runs sampled per hour: ` +
    `${sampled.length} runs, ${jobs.length} jobs that ran`,
);
console.log(`Job wait for a runner: median ${median(allWaits)} min, p90 ${p90(allWaits)} min\n`);

console.log(
  "| Workflow | Runs | Median total (min) | p90 total (min) | Median longest job (min) |",
);
console.log("|---|---|---|---|---|");
for (const [name, row] of [...byWorkflow].toSorted(
  ([, a], [, b]) => b.total.length - a.total.length,
)) {
  if (row.total.length < 5) continue;
  console.log(
    `| ${name} | ${row.total.length} | ${median(row.total)} | ${p90(row.total)} | ${median(row.longestJob)} |`,
  );
}

console.log("\n| Hour (UTC) | Jobs | Median wait (min) | p90 wait (min) | Work (h) |");
console.log("|---|---|---|---|---|");
for (const [hour, row] of [...byHour].toSorted(([a], [b]) => a - b)) {
  console.log(
    `| ${String(hour).padStart(2, "0")} | ${row.waits.length} | ${median(row.waits)} | ${p90(row.waits)} | ${minutes(row.work / 60)} |`,
  );
}
