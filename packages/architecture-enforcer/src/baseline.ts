import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { type Instant, nowInstant } from "@langwatch/time";
import type { ArchitectureViolation } from "./types.ts";

/**
 * One shape for every ratchet that ratchets: a version, the policy that owns
 * the file, and rows keyed in that policy's own grammar. Reading, validating,
 * comparing and writing all happen here, so a reader learns one mechanism and
 * a stale row is a stale row wherever it is found.
 */

export const BASELINE_VERSION = 1;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const entrySchema = z
  .object({
    key: z.string().min(1),
    measured: z.string().regex(DATE),
    expires: z.string().regex(DATE).optional(),
    count: z.number().int().nonnegative().optional(),
  })
  .strict();

const fileSchema = z
  .object({
    version: z.literal(BASELINE_VERSION),
    policy: z.string().min(1),
    entries: z.array(entrySchema),
  })
  .strict();

export type BaselineEntry = z.infer<typeof entrySchema>;
export type Baseline = z.infer<typeof fileSchema>;

/** The words one row puts in front of the reader who has to act on it. */
export type RowCopy = { message: string; allowed?: string };

export type BaselineGrowthCopy = {
  added: (entry: BaselineEntry) => RowCopy;
  /**
   * A rule that did not exist in the merge base cannot have shrunk from
   * anything, so its first measurement is a seed rather than growth. Growth of
   * a rule the merge base already knew is still refused.
   */
  seeds?: (entry: BaselineEntry, reference: readonly BaselineEntry[]) => boolean;
  raised?: (entry: BaselineEntry) => RowCopy;
  postponed?: (entry: BaselineEntry) => RowCopy;
};

export type BaselinePolicy = {
  /** The policy the ratchet belongs to; its own findings carry `<id>-baseline`. */
  id: string;
  /** File name under `packages/architecture-enforcer/src`. */
  file: string;
  /** How the validation messages name the file, e.g. "Feature shape baseline". */
  label: string;
  /** How the file's first entry comment states what a `key` is. */
  keyRule: string;
  /**
   * D2 is Alex's and still open. `true` keeps today's refusal of a row past
   * its date; `false` reads `expires` without acting on it and lets the
   * ratchet only shrink. One field per policy, one line to flip.
   */
  enforceExpiry: boolean;
  /** Findings about the file itself. Defaults to `<id>-baseline`. */
  reportAs?: string;
  /** Stale rows, where the policy already spells them otherwise. Defaults to `reportAs`. */
  staleAs?: string;
  /** Expired rows, likewise. Defaults to `reportAs`. */
  expiredAs?: string;
  /** Merge-base growth, likewise. Defaults to `reportAs`. */
  growthAs?: string;
  /** An empty file is an exception surface with nothing left to except. */
  refuseEmpty?: boolean;
  /** What a row no live finding matches says. */
  stale: (entry: BaselineEntry) => RowCopy;
  /** What a row past its date says. Required when `enforceExpiry` is true. */
  expired?: (entry: BaselineEntry) => RowCopy;
  /** Shrink-mode copy: a key the merge base did not carry, a raised count, a later date. */
  growth?: BaselineGrowthCopy;
};

export type BaselineRead = {
  exists: boolean;
  entries: BaselineEntry[];
  violations: ArchitectureViolation[];
};

export function baselinePath({ root, policy }: { root: string; policy: BaselinePolicy }): string {
  return join(root, "packages/architecture-enforcer/src", policy.file);
}

function reportAs(policy: BaselinePolicy): string {
  return policy.reportAs ?? `${policy.id}-baseline`;
}

type RowKind = "stale" | "expired" | "growth";

/** The policy string one kind of row is reported under, spelled the way it always was. */
function nameFor(policy: BaselinePolicy, kind: RowKind): string {
  const overrides = { stale: policy.staleAs, expired: policy.expiredAs, growth: policy.growthAs };

  return overrides[kind] ?? reportAs(policy);
}

type RowArgs = { policy: BaselinePolicy; file: string; copy: RowCopy; kind: RowKind };

function violation({ policy, file, copy, kind }: RowArgs): ArchitectureViolation {
  const stale = kind === "stale" ? { stale: true as const } : {};

  return { policy: nameFor(policy, kind), file, ...copy, ...stale };
}

type FileArgs = { policy: BaselinePolicy; file: string; message: string; allowed?: string };

function fileViolation({ policy, file, message, allowed }: FileArgs): ArchitectureViolation {
  return { policy: reportAs(policy), file, message, allowed };
}

function invalid({
  policy,
  file,
  reason,
}: {
  policy: BaselinePolicy;
  file: string;
  reason: string;
}): BaselineRead {
  return {
    exists: true,
    entries: [],
    violations: [fileViolation({ policy, file, message: `${policy.label} ${reason}` })],
  };
}

/** Code-unit order on `key`, the same comparison the reader validates with. */
function byKey(left: BaselineEntry, right: BaselineEntry): number {
  if (left.key === right.key) return 0;

  return left.key < right.key ? -1 : 1;
}

type OrderArgs = { policy: BaselinePolicy; file: string; entries: readonly BaselineEntry[] };

function orderViolation({ policy, file, entries }: OrderArgs): ArchitectureViolation | undefined {
  const duplicate = entries.find((row, index) => index > 0 && entries[index - 1]?.key === row.key);

  if (duplicate) {
    return fileViolation({
      policy,
      file,
      message: `${policy.label} lists ${duplicate.key} more than once.`,
      allowed: "Keep one row per key; the file is an inventory, not a log.",
    });
  }

  const unsorted = entries.some(
    (entry, index) => index > 0 && byKey(entries[index - 1]!, entry) > 0,
  );

  if (!unsorted) return void 0;

  return fileViolation({
    policy,
    file,
    message: `${policy.label} entries must be sorted by key.`,
    allowed: `Sort the rows by key in code-unit order. ${policy.keyRule}`,
  });
}

/** Reads one baseline file and validates its shape, its order and its dates. */
export function readBaseline({
  policy,
  file,
}: {
  policy: BaselinePolicy;
  file: string;
}): BaselineRead {
  if (!existsSync(file)) return { exists: false, entries: [], violations: [] };

  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return invalid({ policy, file, reason: `must be valid JSON: ${reason}` });
  }

  const parsed = fileSchema.safeParse(raw);

  if (!parsed.success) {
    return invalid({
      policy,
      file,
      reason: `must be version ${BASELINE_VERSION} with a policy name and entries of { key, measured, expires?, count? }.`,
    });
  }

  if (parsed.data.policy !== policy.id) {
    return invalid({
      policy,
      file,
      reason: `names policy "${parsed.data.policy}"; this file belongs to "${policy.id}".`,
    });
  }

  const entries = parsed.data.entries;
  const disorder = orderViolation({ policy, file, entries });

  if (disorder) return { exists: true, entries, violations: [disorder] };

  return { exists: true, entries, violations: [] };
}

function today(now: Instant): string {
  return now.toString({ fractionalSecondDigits: 3 }).slice(0, 10);
}

/** Rows whose `expires` has passed, when the policy refuses them. */
export function expiredRows({
  entries,
  policy,
  file,
  now = nowInstant(),
}: {
  entries: readonly BaselineEntry[];
  policy: BaselinePolicy;
  file: string;
  now?: Instant;
}): ArchitectureViolation[] {
  const expired = policy.expired;

  if (!policy.enforceExpiry || !expired) return [];

  const date = today(now);

  return entries
    .filter((entry) => entry.expires !== void 0 && entry.expires < date)
    .map((entry) => violation({ policy, file, copy: expired(entry), kind: "expired" }));
}

/** The keys still exempting anything: every key, minus the dated ones already past. */
export function liveKeys({
  entries,
  now = nowInstant(),
}: {
  entries: readonly BaselineEntry[];
  now?: Instant;
}): Set<string> {
  const date = today(now);

  return new Set(
    entries
      .filter((entry) => entry.expires === void 0 || entry.expires >= date)
      .map((entry) => entry.key),
  );
}

/** Rows no live finding matches: the allowance outlived what it allowed. */
export function staleRows({
  entries,
  found,
  policy,
  file,
  skipExpired = false,
  now = nowInstant(),
}: {
  entries: readonly BaselineEntry[];
  found: ReadonlySet<string>;
  policy: BaselinePolicy;
  file: string;
  /** An expired row is already refused by name; do not refuse it twice. */
  skipExpired?: boolean;
  now?: Instant;
}): ArchitectureViolation[] {
  const date = today(now);

  return entries
    .filter((entry) => !found.has(entry.key))
    .filter((entry) => !(skipExpired && entry.expires !== void 0 && entry.expires < date))
    .map((entry) => violation({ policy, file, copy: policy.stale(entry), kind: "stale" }));
}

/** A file with rows and nothing to except is a door left open for the next author. */
export function emptyBaselineRows({
  read,
  policy,
  file,
}: {
  read: BaselineRead;
  policy: BaselinePolicy;
  file: string;
}): ArchitectureViolation[] {
  const empty =
    policy.refuseEmpty === true &&
    read.exists &&
    read.entries.length === 0 &&
    read.violations.length === 0;

  if (!empty) return [];

  return [
    fileViolation({
      policy,
      file,
      message: `An empty ${policy.label.toLowerCase()} must be deleted rather than kept as an exception surface.`,
    }),
  ];
}

/** The merge-base comparison: the file may lose rows, never gain them. */
export function shrinkCheck({
  current,
  reference,
  policy,
  file,
}: {
  current: readonly BaselineEntry[];
  reference: readonly BaselineEntry[];
  policy: BaselinePolicy;
  file: string;
}): ArchitectureViolation[] {
  const growth = policy.growth;

  if (!growth) return [];

  const before = new Map(reference.map((entry) => [entry.key, entry]));
  const violations: ArchitectureViolation[] = [];

  for (const entry of current) {
    const previous = before.get(entry.key);

    if (!previous) {
      if (growth.seeds?.(entry, reference)) continue;

      violations.push(violation({ policy, file, copy: growth.added(entry), kind: "growth" }));
      continue;
    }

    const raised = growth.raised && (entry.count ?? 0) > (previous.count ?? 0);

    if (raised && growth.raised) {
      violations.push(violation({ policy, file, copy: growth.raised(entry), kind: "growth" }));
    }

    const postponed =
      growth.postponed && entry.expires !== void 0 && (previous.expires ?? "") < entry.expires;

    if (postponed && growth.postponed) {
      violations.push(violation({ policy, file, copy: growth.postponed(entry), kind: "growth" }));
    }
  }

  return violations;
}

/** The one writer. Stable output: sorted by key, two-space JSON, one trailing newline. */
export function formatBaseline({
  policy,
  entries,
}: {
  policy: BaselinePolicy;
  entries: readonly BaselineEntry[];
}): string {
  const sorted = [...entries].sort(byKey);
  const document = { version: BASELINE_VERSION, policy: policy.id, entries: sorted };

  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * The rows a fresh measurement produces: one per live key, keeping the date an
 * existing row already carries. A dated review survives only where the policy
 * acts on one, so a file the lint never reads a date from never grows one.
 */
export function collectBaseline({
  policy,
  found,
  previous = [],
  measured,
  now = nowInstant(),
}: {
  policy: BaselinePolicy;
  found: ReadonlySet<string> | readonly string[];
  previous?: readonly BaselineEntry[];
  measured?: string;
  now?: Instant;
}): BaselineEntry[] {
  const kept = new Map(previous.map((entry) => [entry.key, entry]));
  const date = measured ?? today(now);

  return [...new Set(found)]
    .map((key) => {
      const prior = kept.get(key);
      const carried = prior ?? { key, measured: date };
      const { expires, ...row } = carried;

      return policy.enforceExpiry && expires !== void 0 ? { ...row, expires } : row;
    })
    .sort(byKey);
}
