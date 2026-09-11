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

/**
 * A process that opens no client.
 *
 * Absence of a member is a refusal only when a module actually reads one, and
 * the eager build already refuses by name. A test that installs modules
 * reading nothing therefore needs no source at all, and saying so here keeps
 * `createApp` free of a dependency on the package that builds real clients.
 */
export function noMembers<Members>(): MemberSource<Members> {
  return {
    order: [],
    read(name) {
      throw new Error(`This process opened no clients, so it cannot read the "${name}" member.`);
    },
    async close() {},
  };
}

/**
 * The members a caller hands in, as a source.
 *
 * This is the whole of ruling 11's test seam: a member passed is used, and a
 * member absent is refused BY NAME when a module reads it, never quietly
 * replaced. It opens nothing, so a test that needs a frozen clock and a memory
 * cache says so and gets no client library with it.
 */
export function membersFrom<Members>(
  supplied: Readonly<Partial<Members>>,
): MemberSource<Members> {
  const names = Object.keys(supplied) as (keyof Members & string)[];

  return {
    order: names,
    read(name) {
      if (!Object.hasOwn(supplied, name)) {
        throw new Error(`No "${name}" member was handed to this process.`);
      }

      return supplied[name] as Members[typeof name];
    },
    async close() {},
  };
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

/**
 * A member named twice: read off the process, and handed in at the install.
 *
 * The two sources are complements, not alternatives - the pool answers the
 * names a module declared with `reads(...)`, the install answers the
 * collaborators that are the module's own - so a name claimed by both has no
 * answer to which one the App got. Naming it here is the honest refusal;
 * silently letting one win is how a process ends up handing a module a
 * collaborator it never reads.
 */
export class DuplicateModuleMemberError extends Error {
  constructor(
    readonly module: string,
    readonly member: string,
  ) {
    super(
      `Module "${module}" declares it reads the "${member}" member off this process, and its install was also handed a "${member}". Take it out of one of the two.`,
    );
    this.name = "DuplicateModuleMemberError";
  }
}

/**
 * The one record a module's App is handed, from the two places it can come from.
 *
 * A module's members are not all of one kind. The names it declared with
 * `reads(...)` are the PROCESS's to answer, off the pool every module shares,
 * and `buildClaimedMembers` has already built and refused those by the time
 * this runs. The rest are the MODULE's own collaborators - the second slot of
 * its `FeatureSetup` - which no pool can hold, because no other module has a
 * use for them; they arrive per install, through `withModule`.
 *
 * The cast is sound exactly here and nowhere upstream of it. This function is
 * called from the closure `withModule` and `withModules` build, which is the
 * one place that still knows the module's own `Members` type, and that is where
 * both halves are answered for: every name in `reads` is present in `view`,
 * because boot refused by name otherwise, and the module's own collaborators
 * are present in `handed`, because `withModule` refuses an install that hands
 * none and holds a bag it was handed to the module's own members.
 *
 * One seam in that is narrower than it reads, and the comment would be a lie
 * without it: where a process installs through a helper generic over its own
 * pool, `withModule` cannot tell which names the pool answers, so it holds the
 * bag to `Partial` of the module's members and a partial bag compiles. What
 * still holds there is everything runtime can see - the `reads` names, refused
 * by name, and a name claimed twice, refused by name - and what is lost is only
 * the compile-time completeness of a bespoke bag.
 *
 * Casting anywhere higher - where the type is the process pool's rather than
 * the module's - is what let a module receive a frozen `{}` with every
 * collaborator `undefined`.
 */
export function moduleMembers<Members>(options: {
  /** The module's name, for the refusal to name. */
  readonly module: string;
  /** What its App declared it reads off the process, as boot read it back. */
  readonly reads: readonly string[];
  /** This process's view of exactly those names, already built and refused. */
  readonly view: Readonly<Record<string, unknown>>;
  /** The module's own collaborators, where its install handed them in. */
  readonly handed: Readonly<Record<string, unknown>> | undefined;
}): Members {
  const { module, reads, view, handed } = options;
  if (handed === void 0) return view as Members;

  for (const name of reads) {
    if (Object.hasOwn(handed, name)) throw new DuplicateModuleMemberError(module, name);
  }

  // A copy, so the bag the caller still holds is never frozen underneath it.
  return Object.freeze({ ...view, ...handed }) as Members;
}
