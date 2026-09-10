/**
 * What a module says it reads, and the refusal a process gets when it cannot
 * supply it.
 *
 * A module states its members in one line on its App (`static readonly reads =
 * reads("clock", "logger")`). Boot builds exactly the union of every installed
 * module's declaration and the chosen repository tier's own requirements,
 * eagerly, in the order the member source names — so a process that cannot
 * supply one refuses before it serves a request, naming the module that asked
 * and the member it asked for, rather than throwing on the first call that
 * reaches it.
 */

/** Where a process's members come from. Built by `@langwatch/infrastructure`. */
export interface MemberSource<Members> {
  /** Every member this source can build, in construction order. */
  readonly order: readonly (keyof Members & string)[];
  /** Builds the member, or refuses naming it. Repeated reads answer once. */
  read<Name extends keyof Members & string>(name: Name): Members[Name];
  /** Closes every client this source opened, in reverse construction order. */
  close(): Promise<void>;
}

/** A member a module declared that this process cannot supply. */
export class MissingMemberError extends Error {
  constructor(
    readonly module: string,
    readonly member: string,
    options?: { cause?: unknown },
  ) {
    super(
      `Module "${module}" reads the "${member}" member, which this process cannot supply.`,
      options,
    );
    this.name = "MissingMemberError";
  }
}

/** One module's declaration, as boot reads it to compute the union. */
export interface MemberClaim {
  readonly module: string;
  readonly members: readonly string[];
}

/**
 * Builds every claimed member once, in the source's construction order, and
 * hands back the record boot slices each module's own view out of.
 *
 * The order matters and is the source's, not the claim order: `prisma` is open
 * before `clickhouse` and `objectStorage` place a tenant through it, and
 * `redis` is open before the three members built over it.
 */
export function buildClaimedMembers<Members>(options: {
  source: MemberSource<Members>;
  claims: readonly MemberClaim[];
}): Readonly<Record<string, unknown>> {
  const claimedBy = new Map<string, string>();
  for (const claim of options.claims) {
    for (const member of claim.members) {
      if (!claimedBy.has(member)) claimedBy.set(member, claim.module);
    }
  }

  const members: Record<string, unknown> = {};
  for (const name of options.source.order) {
    const module = claimedBy.get(name);
    if (module === undefined) continue;
    try {
      members[name] = options.source.read(name as keyof Members & string);
    } catch (error) {
      throw new MissingMemberError(module, name, { cause: error });
    }
  }

  // A claimed name the source cannot name at all is still the module's
  // refusal, not a silent omission.
  for (const [name, module] of claimedBy) {
    if (!Object.hasOwn(members, name)) throw new MissingMemberError(module, name);
  }

  return Object.freeze(members);
}

/** The view one module gets: the members it declared, and nothing else. */
export function membersFor(
  members: Readonly<Record<string, unknown>>,
  names: readonly string[],
): Readonly<Record<string, unknown>> {
  const view: Record<string, unknown> = {};
  for (const name of names) view[name] = members[name];
  return Object.freeze(view);
}
