import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * Guarded teardown for integration tests that write to the shared local
 * database.
 *
 * Prisma drops `undefined` from a where clause rather than matching
 * nothing, so `deleteMany({ where: { id: teamId } })` with `teamId`
 * unassigned is `deleteMany({})`: every row in the table. Test ids are
 * typically `let` variables assigned inside `beforeAll`, which TypeScript
 * cannot verify across the callback boundary, so the value is undefined
 * exactly when setup already failed, and the hand-rolled teardown turns a
 * broken setup into a destructive sweep across every other suite and
 * worktree (#6219).
 *
 * This helper makes that collapse structurally impossible:
 *
 *   - a filter value that is undefined, an empty string, an empty object,
 *     or an empty list means the entry no longer identifies anything, so
 *     the entry deletes NOTHING and the problem is reported by model and
 *     field;
 *   - entries that are still fully identified are cleaned, so a partially
 *     failed setup still gets its partial cleanup;
 *   - after everything cleanable is cleaned, any refusal or delete failure
 *     is thrown as one loud error. Nothing is ever swallowed: the blanket
 *     `.catch(() => {})` habit is what kept the sweep invisible and hid
 *     real tenancy-guard errors besides.
 *
 * `null` stays allowed: Prisma keeps `null` in the filter (matches SQL
 * NULL), so `{ archivedAt: null }` is a real, intentional predicate.
 *
 * Entries run sequentially in the order given, so callers order them
 * child-before-parent exactly as they ordered the raw deletes.
 *
 * Spec: specs/setup/test-teardown-safety.feature
 *
 * ```ts
 * afterAll(() =>
 *   cleanupTestRows(prisma, [
 *     ["modelProvider", { organizationId: orgId }],
 *     ["team", { id: { in: teamIds } }],
 *     ["user", { email: `x-${ns}@example.com` }],
 *   ]),
 * );
 * ```
 */

type DeleteManyDelegate = {
  deleteMany: (args?: { where?: unknown }) => Promise<unknown>;
};

/**
 * Model names from the generated client's TypeMap, which is the supported
 * way to reach per-operation argument types. Extracting `where` from the
 * delegate methods instead does not survive their generic signatures.
 */
type ModelName = keyof Prisma.TypeMap["model"] & string;

type WhereOf<M extends ModelName> = NonNullable<
  Prisma.TypeMap["model"][M]["operations"]["deleteMany"]["args"]["where"]
>;

/**
 * One teardown entry: a model (client property name, camelCase) plus the
 * filter identifying this suite's rows.
 */
export type CleanupEntry = {
  [M in ModelName]: readonly [Uncapitalize<M>, WhereOf<M>];
}[ModelName];

type SanitizeResult = {
  /** Rebuilt filter, or undefined when the entry must not run. */
  where?: Record<string, unknown>;
  /** Human-readable refusals, each naming the offending path. */
  fatal: string[];
  /** Non-fatal narrowings (dropped list members), still reported loudly. */
  dropped: string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

type SanitizeCollectors = {
  /** Refusals: the entry must not run, and the teardown ends loud. */
  fatal: string[];
  /** Narrowings (dropped list members): the entry runs, still ends loud. */
  dropped: string[];
  /**
   * Legitimate no-ops: a list that ARRIVED empty. The entry is skipped
   * silently, because that is exactly what Prisma's `in: []` did.
   */
  emptyAtArrival: string[];
};

function sanitizeValue(value: unknown, path: string, collectors: SanitizeCollectors): unknown {
  if (value === undefined) {
    collectors.fatal.push(`${path} is undefined, so this filter no longer identifies anything`);
    return undefined;
  }
  if (value === "") {
    collectors.fatal.push(`${path} is an empty string`);
    return undefined;
  }
  if (Array.isArray(value)) return sanitizeList(value, path, collectors);
  if (isPlainObject(value)) return sanitizeObject(value, path, collectors);
  return value;
}

function sanitizeList(value: unknown[], path: string, collectors: SanitizeCollectors): unknown {
  // A list that ARRIVES empty is the accumulator pattern: `let ids = []`
  // filled as tests create rows, legitimately empty when they created
  // none. Prisma's `in: []` matches nothing, so a silent skip preserves
  // the raw form's behavior exactly, and match-none is not the hazard
  // this guard exists for; match-all is. A list that BECOMES empty
  // because its members were dropped below is different: real ids were
  // intended and lost, so that stays a refusal.
  if (value.length === 0) {
    collectors.emptyAtArrival.push(path);
    return undefined;
  }
  const kept: unknown[] = [];
  value.forEach((member, index) => {
    if (member === undefined || member === null || member === "") {
      collectors.dropped.push(`${path}[${index}] was ${describe(member)}; dropped`);
      return;
    }
    // Object members recurse: `OR: [{ scopeId: undefined }]` collapses
    // exactly like a bare undefined, just one level down.
    if (Array.isArray(member) || isPlainObject(member)) {
      kept.push(sanitizeValue(member, `${path}[${index}]`, collectors));
      return;
    }
    kept.push(member);
  });
  if (kept.length === 0) {
    collectors.fatal.push(`${path} lost every member to the drops above, so it identifies nothing`);
    return undefined;
  }
  return kept;
}

function sanitizeObject(
  value: Record<string, unknown>,
  path: string,
  collectors: SanitizeCollectors,
): unknown {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    // `{ id: {} }` is an empty nested filter: it matches every row,
    // exactly the collapse this helper exists to prevent.
    collectors.fatal.push(`${path} is an empty object, which matches every row`);
    return undefined;
  }
  const rebuilt: Record<string, unknown> = {};
  for (const key of keys) {
    rebuilt[key] = sanitizeValue(value[key], `${path}.${key}`, collectors);
  }
  return rebuilt;
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value === "") return "an empty string";
  return String(value);
}

function sanitizeWhere(where: unknown, label: string): SanitizeResult {
  const collectors: SanitizeCollectors = {
    fatal: [],
    dropped: [],
    emptyAtArrival: [],
  };
  if (!isPlainObject(where) || Object.keys(where).length === 0) {
    return {
      fatal: [`${label}.where must be a non-empty object`],
      dropped: [],
    };
  }
  const rebuilt = sanitizeValue(where, `${label}.where`, collectors) as
    | Record<string, unknown>
    | undefined;
  const { fatal, dropped, emptyAtArrival } = collectors;
  if (fatal.length > 0) return { fatal, dropped };
  // An arrived-empty list anywhere makes the whole entry a match-none
  // no-op: skip it silently rather than deleting with a partial filter.
  if (emptyAtArrival.length > 0) return { fatal, dropped };
  return { where: rebuilt, fatal, dropped };
}

/**
 * Loud anchor for the few teardowns that must collect ids BEFORE deleting
 * (tenancy guards on models like ProjectSecret demand literal
 * `projectId.in` filters, so a `findMany` prelude gathers them). That
 * prelude has the same collapse as the deletes: `findMany({ where: {
 * teamId: undefined } })` is `findMany({})`, every row in the table, which
 * would then feed everyone's ids into the cleanup. Anchoring the prelude
 * on `requireAssigned({ value: teamId, name: "teamId" })` makes a broken
 * setup throw before any query runs.
 */
export function requireAssigned<T>({
  value,
  name,
}: {
  value: T | undefined | null;
  name: string;
}): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `${name} was never assigned, which usually means beforeAll threw ` +
        "before assigning it. Refusing to collect cleanup ids with an " +
        "unanchored filter; rows were left untouched.",
    );
  }
  return value;
}

/**
 * Delete this suite's rows, refusing any entry whose filter can no longer
 * identify them. Throws after cleaning everything cleanable if anything
 * was refused, narrowed, or failed, so a broken setup fails loudly
 * instead of sweeping the table.
 */
export async function cleanupTestRows(
  prisma: PrismaClient,
  entries: readonly CleanupEntry[],
): Promise<void> {
  const problems: string[] = [];
  const runnable: Array<{ model: string; where: Record<string, unknown> }> = [];

  entries.forEach(([model, where], index) => {
    const label = `${String(model)}[${index}]`;
    const { where: cleaned, fatal, dropped } = sanitizeWhere(where, label);
    problems.push(...fatal, ...dropped);
    if (cleaned) {
      runnable.push({ model: String(model), where: cleaned });
    }
  });

  for (const { model, where } of runnable) {
    const delegate = (prisma as unknown as Record<string, unknown>)[model] as
      | DeleteManyDelegate
      | undefined;
    if (!delegate || typeof delegate.deleteMany !== "function") {
      problems.push(`${model} is not a Prisma delegate with deleteMany`);
      continue;
    }
    try {
      await delegate.deleteMany({ where });
    } catch (error) {
      problems.push(
        `${model}.deleteMany failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      "cleanupTestRows refused or failed part of the teardown:\n" +
        problems.map((problem) => `  - ${problem}`).join("\n") +
        "\nAn undefined id here usually means beforeAll threw before " +
        "assigning it. The matching rows were left untouched instead of " +
        "sweeping the table.",
    );
  }
}
