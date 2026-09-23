import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * Guards deleteMany() teardown against destructive sweeps: validates filter
 * values, runs child-before-parent. See specs/setup/test-teardown-safety.feature
 */

type DeleteManyDelegate = {
  deleteMany: (args?: { where?: unknown }) => Promise<unknown>;
};

/**
 * Model names from the generated client's TypeMap, which is the supported
 * way to reach per-operation argument types. Extracting `where` from the
 * delegate methods instead does not survive their generic signatures.
 */
type ModelName = Extract<keyof Prisma.TypeMap["model"], string>;

type WhereOf<M extends ModelName> = NonNullable<
  Prisma.TypeMap["model"][M]["operations"]["deleteMany"]["args"]["where"]
>;

/** A teardown may receive an unassigned id after a setup failure; reject it at runtime. */
type TeardownWhere<Value> = Value extends readonly (infer Item)[]
  ? readonly TeardownWhere<Item>[]
  : Value extends object
    ? { [Key in keyof Value]: TeardownWhere<Value[Key]> | undefined }
    : Value | undefined;

/**
 * One teardown entry: a model (client property name, camelCase) plus the
 * filter identifying this suite's rows.
 */
export type CleanupEntry = {
  [M in ModelName]: readonly [Uncapitalize<M>, TeardownWhere<WhereOf<M>>];
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
  // A list that ARRIVES empty is the accumulator pattern (`let ids = []`
  // filled as rows are created, legitimately empty if none were) — Prisma's
  // `in: []` matches nothing, so a silent skip is safe. A list that BECOMES
  // empty from dropped members is different: real ids were lost, so that stays a refusal.
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
  return typeof value === "string" ? value : (JSON.stringify(value) ?? typeof value);
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
 * Guard for pre-delete findMany: refuse unassigned values to avoid
 * table-wide queries.
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
 * identify them. Throws after cleaning everything cleanable if anything was
 * refused, narrowed or failed — a broken setup fails loudly, not by sweeping the table.
 */
export async function cleanupTestRows(
  prisma: PrismaClient,
  entries: readonly CleanupEntry[],
): Promise<void> {
  const problems: string[] = [];
  const runnable: { model: string; where: Record<string, unknown> }[] = [];

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
