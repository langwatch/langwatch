/**
 * Deterministic `GithubPullRequest` rows for the main user and peers, plus the
 * branch/timestamp facts the coding-agent session rows join against so the
 * "by pull request", "cost per merged PR", "shipping streak" and
 * "doing vs babysitting" cards resolve.
 */
import { DAY_MS, utcDayStart } from "./dates";
import { Rng } from "./prng";

export const REPOS = ["checkout", "billing", "platform", "infra"] as const;

const TITLE_POOL = [
  "Fix flaky checkout test",
  "Harden the refund idempotency key",
  "Batch the usage rollup for large orgs",
  "Stop code blocks aborting at the CLI timeout",
  "Trim the retention scan on the rollup bucket",
  "One door for the raw query REST endpoint",
  "Backfill the team-user mapping",
  "Guard the dashboard widget ids against a leading dash",
  "Retry the gateway budget sweep on a 429",
  "Cut the cold-start graph on the SDK boot path",
  "Migrate the billing webhook to the new envelope",
  "Add the compaction-trigger column to the events table",
  "Deduplicate the pull-request mapping on branch",
  "Wire the finops usage table into the company board",
  "Rebuild the cache-hit gauge from session tokens",
  "Split the integration test lanes by datastore",
  "Rework the scope chip picker for personal projects",
  "Fix the drawer navigation stack on sub-flows",
  "Bound the seed cleanup so it cannot hang Haven",
  "Tag every error path scenario for parity",
];

export interface PrSpec {
  id: string;
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  prNumber: number;
  htmlUrl: string;
  title: string;
  state: string;
  isDraft: boolean;
  authorLogin: string;
  prCreatedAtMs: number;
  prClosedAtMs: number | null;
  prMergedAtMs: number | null;
  prUpdatedAtMs: number;
  /** whether an assistant babysat it after opening (drives the doing/babysit split) */
  babysitShare: number;
}

export interface PrConfig {
  organizationId: string;
  todayMs: number;
  mainLogin: string;
  peerLogins: string[];
  count?: number;
  windowDays?: number;
}

/** Hand-authored post-open share for a few merged PRs; the rest default 0.25. */
const BABYSIT_SHARE: Record<number, number> = {
  471: 0.18,
  474: 0.52,
  476: 0.22,
  478: 0.12,
  480: 0.28,
  482: 0.34,
};

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function buildPullRequests(cfg: PrConfig): PrSpec[] {
  const count = cfg.count ?? 46;
  const windowDays = cfg.windowDays ?? 100;
  const today = utcDayStart(cfg.todayMs);
  const firstNumber = 484 - count + 1;
  const prs: PrSpec[] = [];

  for (let i = 0; i < count; i++) {
    const prNumber = firstNumber + i;
    const rng = new Rng(`pr:${prNumber}`);
    const repo = rng.pick(REPOS);
    const title = rng.pick(TITLE_POOL);
    // Recent PRs cluster in the last three weeks; earlier ones are sparse.
    const recent = i > count - 22;
    const ageDays = recent ? rng.int(0, 20) : rng.int(21, windowDays - 1);
    const createdMs = today - ageDays * DAY_MS + rng.int(8, 20) * 60 * 60_000;
    // A minority stay open or close without merging.
    const roll = rng.next();
    const merged = roll < 0.82;
    const openStill = !merged && roll < 0.92;
    const durationDays = rng.int(0, 4);
    const closedMs = merged ? createdMs + durationDays * DAY_MS + rng.int(1, 9) * 60 * 60_000 : openStill ? null : createdMs + rng.int(1, 6) * DAY_MS;
    // 80% authored by the main user so the /me boards are populated.
    const authorLogin = rng.chance(0.8) ? cfg.mainLogin : rng.pick(cfg.peerLogins);
    const headBranch = `issue${prNumber}/${slugify(title)}`;
    const state = merged || openStill ? (openStill ? "open" : "closed") : "closed";
    prs.push({
      id: `caes-pr-${cfg.organizationId}-${prNumber}`,
      organizationId: cfg.organizationId,
      repositoryHost: "github.com",
      repositoryFullName: `acme/${repo}`,
      headBranch,
      prNumber,
      htmlUrl: `https://github.com/acme/${repo}/pull/${prNumber}`,
      title,
      state: merged ? "closed" : state,
      isDraft: false,
      authorLogin,
      prCreatedAtMs: createdMs,
      prClosedAtMs: closedMs,
      prMergedAtMs: merged ? closedMs : null,
      prUpdatedAtMs: closedMs ?? createdMs,
      babysitShare: BABYSIT_SHARE[prNumber] ?? 0.25,
    });
  }
  return prs;
}
