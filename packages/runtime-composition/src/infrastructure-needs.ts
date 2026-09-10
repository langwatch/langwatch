/**
 * What a module says it needs from the process's one infrastructure pool, and
 * the refusal a process gets when it supplies the member as `undefined`. The
 * type half of the same promise is `withModules`, which will not compile
 * against a pool that lacks a member a module's Infrastructure interface names.
 */

/** The members of `Infrastructure` a `needs(...)` tuple has not yet named. */
export type MissingNeeds<Infrastructure, Members extends readonly string[]> = Exclude<
  keyof Infrastructure & string,
  Members[number]
>;

/**
 * The type a `needs(...)` call resolves to. Complete tuples continue the
 * builder; an incomplete one resolves to a tuple naming what is missing, which
 * has no builder methods, so the compiler reports the missing member by name.
 */
export type NeedsResult<Infrastructure, Members extends readonly string[], Builder> = [
  MissingNeeds<Infrastructure, Members>,
] extends [never]
  ? Builder
  : ["missing infrastructure members", MissingNeeds<Infrastructure, Members>];

/** A pool member a module named and this process supplies as `undefined`. */
export class MissingInfrastructureError extends Error {
  constructor(
    readonly module: string,
    readonly member: string,
  ) {
    super(
      `module "${module}" needs infrastructure member "${member}", which this process's pool supplies as undefined`,
    );
    this.name = "MissingInfrastructureError";
  }
}

/**
 * Read every member a module named off the pool, before any App is created, so
 * a process refuses at boot rather than at the first request that reaches the
 * member.
 */
export function assertInfrastructure(options: {
  module: string;
  members: readonly string[];
  infrastructure: unknown;
}): void {
  const pool = (options.infrastructure ?? {}) as Readonly<Record<string, unknown>>;

  for (const member of options.members) {
    if (pool[member] === undefined) {
      throw new MissingInfrastructureError(options.module, member);
    }
  }
}
