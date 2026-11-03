/**
 * How the Upgrades pages colour and word what the reader answers (UI plan section 4, ADR-173
 * section 7). The reader labels states and step statuses; this adds tones, the version and state
 * lines, and the page's grouping. Unknown values pass through raw in a neutral tone.
 */
import type { UpgradeStatusView, UpgradeVersionView } from "./upgrade-view.ts";

export type UpgradeTone = "neutral" | "info" | "warning" | "danger" | "success";

export type UpgradeLabel = { label: string; tone: UpgradeTone };

/** What a build that is not a release is called; the page has no other word for it. */
export const DEVELOPMENT_BUILD = "Development build";

/** How many characters of a commit the page shows, as git abbreviates it. */
const SHORT_COMMIT_LENGTH = 7;

/** The run that imported the ledger's history from before upgrade tracking. */
const SEED_RUN_KIND = "seed";

const RUN_KINDS: Record<string, string> = {
  [SEED_RUN_KIND]: "Imported history",
  upgrade: "Upgrade",
};

const STATUS_TONES: Record<string, UpgradeTone> = {
  pending: "neutral",
  running: "info",
  done: "success",
  "not-needed": "neutral",
  failed: "danger",
  gated: "neutral",
};

const RUN_OUTCOMES: Record<string, UpgradeLabel> = {
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  abandoned: { label: "Abandoned", tone: "warning" },
};

const PHASE_LABELS: Record<string, string> = {
  preflight: "Preflight",
  "postgres-schema": "Postgres schema",
  "clickhouse-schema": "ClickHouse schema",
  reconcile: "Reconcile",
};

const PHASE_OUTCOMES: Record<string, UpgradeLabel> = {
  running: { label: "Running", tone: "info" },
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

/** A run phase's name as the page words it; a name this release does not know reads raw. */
export function phaseLabel(name: string): string {
  return Object.hasOwn(PHASE_LABELS, name) ? PHASE_LABELS[name]! : name;
}

/** A phase's outcome; one this page does not know reads as stored, in a neutral tone. */
export function phaseOutcomeLabel(outcome: string): UpgradeLabel {
  return Object.hasOwn(PHASE_OUTCOMES, outcome)
    ? PHASE_OUTCOMES[outcome]!
    : { label: outcome, tone: "neutral" };
}

const PREFLIGHT_OUTCOMES: Record<string, UpgradeLabel> = {
  verified: { label: "Pass", tone: "success" },
  refused: { label: "Fail", tone: "danger" },
};

/** A preflight row's outcome in the checkup's words; anything else was not checked. */
export function preflightLabel(outcome: string): UpgradeLabel {
  return Object.hasOwn(PREFLIGHT_OUTCOMES, outcome)
    ? PREFLIGHT_OUTCOMES[outcome]!
    : { label: "Not checked", tone: "neutral" };
}

const MODE_LABELS: Record<string, string> = {
  schema: "Schema",
  blocking: "Blocking",
  background: "Background",
  operator: "Operator",
};

const TONES = new Set<string>(["neutral", "info", "warning", "danger", "success"]);

/** The reader's tone as one this page knows; anything else reads neutral. */
export function toneOf(tone: string): UpgradeTone {
  return TONES.has(tone) ? (tone as UpgradeTone) : "neutral";
}

/** The design-system colour palette a tone renders in. */
export function tonePalette(tone: UpgradeTone): string {
  switch (tone) {
    case "info":
      return "blue";
    case "warning":
      return "orange";
    case "danger":
      return "red";
    case "success":
      return "green";
    case "neutral":
      return "gray";
  }
}

export function statusTone(status: string): UpgradeTone {
  return Object.hasOwn(STATUS_TONES, status) ? STATUS_TONES[status]! : "neutral";
}

/** A run with no outcome yet is running; an outcome this page does not know reads as stored. */
export function runOutcomeLabel(outcome: string | null): UpgradeLabel {
  if (outcome === null) return { label: "Running", tone: "info" };
  return Object.hasOwn(RUN_OUTCOMES, outcome)
    ? RUN_OUTCOMES[outcome]!
    : { label: outcome, tone: "neutral" };
}

export function modeLabel(mode: string): string {
  return Object.hasOwn(MODE_LABELS, mode) ? MODE_LABELS[mode]! : mode;
}

/** A run's kind in words; the seed run reads "Imported history". */
export function runKindLabel(kind: string): string {
  return Object.hasOwn(RUN_KINDS, kind) ? RUN_KINDS[kind]! : kind;
}

export function isImportedHistory(run: { kind: string }): boolean {
  return run.kind === SEED_RUN_KIND;
}

/** A release field in words: no release means a development build. */
export function releaseName(release: string | null): string {
  return release ?? DEVELOPMENT_BUILD;
}

/** "Running 3.21.0", or "Development build 3.20.1+abc1234" for a build that is not a release. */
export function versionLine(version: UpgradeVersionView): string {
  if (version.kind === "release") return `Running ${version.release}`;
  const commit = version.commit?.slice(0, SHORT_COMMIT_LENGTH) ?? null;
  const build =
    version.containsRelease && commit
      ? `${version.containsRelease}+${commit}`
      : (version.containsRelease ?? commit);
  return build ? `${DEVELOPMENT_BUILD} ${build}` : DEVELOPMENT_BUILD;
}

/** The Steps tab's group name; the oldest release holds everything stamped before manifests. */
export function releaseGroupName({
  release,
  oldest,
}: {
  release: string | null;
  oldest: boolean;
}): string {
  if (release === null) return DEVELOPMENT_BUILD;
  return oldest ? `${release} and earlier` : release;
}

/** `organizations` is set when the line names held organizations and links to their tab. */
export type UpgradeStateLine = {
  text: string;
  tone: UpgradeTone;
  retry: boolean;
  organizations?: true;
};

/** The states in which the worker is still carrying the upgrade through. */
const UPGRADING_STATES = new Set([
  "upgrading",
  "behind",
  "never-upgraded",
  "finishing-in-background",
]);

function plural({ count, one, many }: { count: number; one: string; many: string }): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The overview's one state line: up to date, upgrading n of m, needs attention, or refused. */
export function upgradeStateLine(
  status: Pick<UpgradeStatusView, "state" | "label" | "tone" | "summary" | "counts"> & {
    failedStepIds: readonly string[];
    /** Organizations a tenant step holds or parks; they turn Up to date into needs attention. */
    heldOrganizations?: number;
  },
): UpgradeStateLine {
  if (status.state === "up-to-date") {
    const held = status.heldOrganizations ?? 0;
    if (held === 0) return { text: "Up to date", tone: "success", retry: false };
    return {
      text: `Needs attention: ${plural({ count: held, one: "organization held", many: "organizations held" })}`,
      tone: "warning",
      retry: false,
      organizations: true,
    };
  }
  if (status.state === "needs-attention") {
    const failed = status.failedStepIds.length;
    return failed > 0
      ? {
          text: `Needs attention: ${plural({ count: failed, one: "failed step", many: "failed steps" })}`,
          tone: "danger",
          retry: true,
        }
      : { text: `Needs attention: ${status.summary}`, tone: "danger", retry: false };
  }
  if (UPGRADING_STATES.has(status.state)) {
    const total = Object.values(status.counts).reduce((sum, count) => sum + count, 0);
    const settled = total - remainingCount(status.counts);
    const text =
      total > 0 ? `Upgrading: step ${Math.min(settled + 1, total)} of ${total}` : "Upgrading";
    return { text, tone: "info", retry: false };
  }
  return { text: `${status.label}: ${status.summary}`, tone: toneOf(status.tone), retry: false };
}

/**
 * Organizations a tenant step holds or parks, each counted once however many steps hold it. A
 * user-rooted step's holds are users, listed on the Organizations tab but never counted here.
 */
export function heldOrganizationCount(
  migrations: readonly {
    tenant: "organization" | "user";
    migratedIsSteady: boolean;
    attention: readonly { tenantId: string; status: string }[];
  }[],
): number {
  return new Set(
    migrations
      .filter((migration) => migration.tenant === "organization")
      .flatMap((migration) =>
        migration.attention
          // A step whose `migrated` is its steady state keeps those tenants in step, not held.
          .filter((row) => !(migration.migratedIsSteady && row.status === "migrated"))
          .map((row) => row.tenantId),
      ),
  ).size;
}

/**
 * A step's `migrated` count split into the tenants held for a proof or queued work, which need
 * attention, and those waiting on a person, which are expected. The two are read apart, so a
 * tenant that moved between the reads never takes the held count below zero.
 */
export function migratedSplit({
  migrated,
  waitingOnPerson,
}: {
  migrated: number;
  waitingOnPerson: number;
}): { held: number; waitingOnPerson: number } {
  const waiting = Math.min(waitingOnPerson, migrated);
  return { held: migrated - waiting, waitingOnPerson: waiting };
}

/** Steps grouped by release in the reader's order; a step with no release goes last. */
export function groupStepsByRelease<Step extends { release: string | null }>(
  steps: readonly Step[],
): { release: string | null; steps: Step[] }[] {
  const groups: { release: string | null; steps: Step[] }[] = [];
  for (const step of steps) {
    const group = groups.find((candidate) => candidate.release === step.release);
    if (group) group.steps.push(step);
    else groups.push({ release: step.release, steps: [step] });
  }
  return [
    ...groups.filter((group) => group.release !== null),
    ...groups.filter((group) => group.release === null),
  ];
}

/** Step statuses that need nothing more; every other status is still to do. */
const FINISHED_STATUSES = new Set(["done", "not-needed"]);

export function isFinished(status: string): boolean {
  return FINISHED_STATUSES.has(status);
}

/** How many steps a release still has to do, from its counts by status. */
export function remainingCount(counts: Record<string, number>): number {
  return Object.entries(counts)
    .filter(([status]) => !isFinished(status))
    .reduce((sum, [, count]) => sum + count, 0);
}

function releaseParts(release: string): number[] {
  return release.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
}

/** The development build first (cloud tracks main), then newest release first. */
export function orderReleasesNewestFirst<Release extends { release: string | null }>(
  releases: readonly Release[],
): Release[] {
  return releases.toSorted((a, b) => {
    if (a.release === null || b.release === null) return a.release === null ? -1 : 1;
    const left = releaseParts(a.release);
    const right = releaseParts(b.release);
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const difference = (right[index] ?? 0) - (left[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  });
}

/** The longest an error summary reads before it is cut; the full text is a click away. */
const ERROR_SUMMARY_LENGTH = 90;

/** An error's first clause, parenthesised detail dropped, cut to one readable line. */
export function summariseError(error: string): string {
  const clause = (error.split(/[;\n]/)[0] ?? error).replace(/\s*\([^)]*\)/g, "").trim();
  const sentence = clause.charAt(0).toUpperCase() + clause.slice(1);
  return sentence.length > ERROR_SUMMARY_LENGTH
    ? `${sentence.slice(0, ERROR_SUMMARY_LENGTH - 1).trimEnd()}…`
    : sentence;
}

/** A status count's words: `not-needed` reads "not needed". */
export function statusWords(status: string): string {
  return status.replaceAll("-", " ");
}
