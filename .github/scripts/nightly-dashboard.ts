// The nightly dashboard: codebase health's pinned issue, now with every nightly job's outcome
// and report, and a nightly-regression issue for a failed job. Without --publish (any branch
// but the default) it writes the run summary only. dev/docs/nightly-suite.md; spec:
// specs/ci/nightly-suite.feature.   NEEDS_JSON='${{ toJSON(needs) }}' node \
//   --experimental-strip-types .github/scripts/nightly-dashboard.ts --sections sections [--publish]

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  listOpenIssues,
  publishDashboard,
  publishIssue,
} from "../../dev/scripts/codebase-health.mjs";

export const REGRESSION_LABEL = "nightly-regression";
/** GitHub refuses an issue body over 65,536 characters; this leaves room to spare. */
export const ISSUE_BODY_LIMIT = 60_000;

export interface NightlyJob {
  id: string;
  title: string;
  /** The section file this job's report leaves, if it writes one. */
  section?: string;
  redWhen: string;
}

export const JOBS: NightlyJob[] = [
  {
    id: "codebase-health",
    title: "Codebase health and typecheck trends",
    section: "codebase-health.md",
    redWhen: "the measuring itself breaks; a jump opens a codebase-health issue instead",
  },
  {
    id: "hygiene-report",
    title: "Hygiene and lint",
    section: "hygiene.md",
    redWhen:
      "a rule's count rose, a new rule appeared, a check started failing, or a tool did not report",
  },
  {
    id: "flaky-report",
    title: "Flaky-test hunt",
    section: "flaky.md",
    redWhen: "a test is flaky that was not flaky last night",
  },
  {
    id: "upgrade-lab",
    title: "Upgrade lab",
    section: "upgrade-lab.md",
    redWhen: "an invariant of the upgrade from the last release to head does not pass",
  },
  {
    id: "migration-compat",
    title: "Migration compatibility",
    redWhen: "the last release's image does not boot on the schema head migrated",
  },
  {
    id: "npx-server-smoke",
    title: "npx server smoke",
    redWhen: "the packed server does not reach healthy on a supported platform",
  },
  {
    id: "gateway-matrix",
    title: "AI Gateway provider matrix",
    redWhen: "a provider scenario fails against the live providers",
  },
];

export interface JobOutcome {
  id: string;
  title: string;
  result: string;
}

/** Each job's result from the `needs` context; a job missing from it did not run. */
export const jobOutcomes = ({
  needs,
}: {
  needs: Record<string, { result?: string } | undefined>;
}): JobOutcome[] =>
  JOBS.map((job) => ({ id: job.id, title: job.title, result: needs[job.id]?.result ?? "not run" }));

const MARK: Record<string, string> = {
  success: "passed",
  failure: "**failed**",
  cancelled: "cancelled",
  skipped: "skipped",
};

/** A section cut at a line boundary to `budget` characters, saying where the rest is. */
export const cutSection = ({ section, budget }: { section: string; budget: number }): string => {
  if (section.length <= budget) return section;
  const kept = section.slice(0, Math.max(0, budget - 120));
  return `${kept.slice(0, kept.lastIndexOf("\n"))}\n\n_Cut to fit the issue; the whole section is in the run's summary._\n`;
};

/** The dashboard: a table of every job, then each report's section, within the issue size limit. */
export const renderNightlyDashboard = ({
  date,
  commit,
  runUrl,
  jobs,
  sections,
  regressionIssues,
  limit = ISSUE_BODY_LIMIT,
}: {
  date: string;
  commit: string;
  runUrl: string;
  jobs: JobOutcome[];
  sections: string[];
  regressionIssues: { url: string; title: string }[];
  limit?: number;
}): string => {
  const header = [
    "# Nightly dashboard",
    "",
    `Updated ${date} on commit \`${commit.slice(0, 10)}\` by [this run](${runUrl}). Rewritten after every nightly run; comments here are not read.`,
    "",
    "| job | tonight | goes red when |",
    "| --- | --- | --- |",
    ...jobs.map((job) => {
      const catalogued = JOBS.find((item) => item.id === job.id);
      return `| ${job.title} | ${MARK[job.result] ?? job.result} | ${catalogued?.redWhen ?? ""} |`;
    }),
    "",
    "### Open nightly regression issues",
    "",
    ...(regressionIssues.length === 0
      ? ["None."]
      : regressionIssues.map((issue) => `- ${issue.url} ${issue.title}`)),
    "",
  ].join("\n");
  const whole = [header, ...sections].join("\n");
  if (whole.length <= limit || sections.length === 0) return whole;
  const budget = Math.floor((limit - header.length) / sections.length);
  return [header, ...sections.map((section) => cutSection({ section, budget }))].join("\n");
};

/** The failed jobs, as the breach rows codebase health's issue code takes. */
export const failedJobs = ({ jobs }: { jobs: JobOutcome[] }): { metric: string }[] =>
  jobs.filter((job) => job.result === "failure").map((job) => ({ metric: job.title }));

const option = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  const args = process.argv.slice(2);
  const publish = args.includes("--publish");
  const dir = option(args, "sections") ?? "sections";
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const jobs = jobOutcomes({ needs: JSON.parse(process.env.NEEDS_JSON ?? "{}") });
  const sections = JOBS.filter((job) => job.section).map((job) =>
    job.section && files.includes(job.section)
      ? readFileSync(join(dir, job.section), "utf8")
      : `## ${job.title}\n\nNo report tonight: the job did not leave one. Its log is in the run.\n`,
  );
  const date = new Date().toISOString().slice(0, 10);
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const failed = failedJobs({ jobs });
  const issueBody = [
    `Nightly run ${runUrl} on \`${(process.env.GITHUB_SHA ?? "").slice(0, 10)}\`:`,
    "",
    ...failed.map((job) => `- ${job.metric} failed`),
  ].join("\n");
  if (publish) {
    const plan = publishIssue({
      breaches: failed,
      date,
      body: issueBody,
      label: REGRESSION_LABEL,
      subject: "Nightly",
      description: "A nightly job that failed",
    });
    console.log(`regression issue: ${plan.kind}`);
  }
  const body = renderNightlyDashboard({
    date,
    commit: process.env.GITHUB_SHA ?? "unknown",
    runUrl,
    jobs,
    sections,
    regressionIssues: publish
      ? listOpenIssues({ label: REGRESSION_LABEL, fields: "title,url" })
      : [],
  });
  writeFileSync("nightly-dashboard.md", body);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [body.split("\n## ")[0], ...sections].join("\n"),
    );
  if (publish) console.log(`dashboard: ${publishDashboard({ body }).kind}`);
  else console.log("not the default branch: the dashboard is in the run summary only");
}
