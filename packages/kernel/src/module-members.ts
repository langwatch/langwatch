/**
 * What a module reads and the refusal a process gets when it cannot supply it.
 * Boot builds the union of every module's member declaration, failing eagerly.
 */

/** Where a process's members come from. Built by `@langwatch/process-stores`. */
export interface MemberSource<Members> {
  /** Every member this source can build, in construction order. */
  readonly order: readonly (keyof Members & string)[];
  /** Builds the member, or refuses naming it. Repeated reads answer once. */
  read<Name extends keyof Members & string>(name: Name): Members[Name];
  /** Closes every client this source opened, in reverse construction order. */
  close(): Promise<void>;
}

/**
 * A process that opens no client. Absence of a member is a refusal only when
 * a module actually reads one — a test installing modules that read nothing
 * needs no source, keeping `createApp` free of the real-client package.
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
 * The members a caller hands in, as a source. This is ruling 11's test seam:
 * a member passed is used, one absent is refused BY NAME when read, never
 * quietly replaced — so a frozen clock plus memory cache needs no client library.
 */
export function membersFrom<Members>(supplied: Readonly<Partial<Members>>): MemberSource<Members> {
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

/** What a process's opened stores hand boot: names in build order, values on demand. */
export interface StoresMemberSource {
  /** Repository selection belongs to the whole supplied store tier. */
  readonly tier?: "live" | "memory";
  readonly order: readonly string[];
  read(name: string): unknown;
}

/**
 * The stores source answers every standard member; hand-supplied members
 * (bespoke names, test doubles) override it and extend its order.
 */
export function storesBackedMembers(
  stores: StoresMemberSource,
  overrides: Readonly<Record<string, unknown>>,
): MemberSource<Record<string, unknown>> {
  const overrideNames = Object.keys(overrides);
  const order = [
    ...stores.order.filter((name) => !Object.hasOwn(overrides, name)),
    ...overrideNames,
  ];

  return {
    order,
    read(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      return stores.read(name);
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
 * Builds every claimed member once, in the source's own construction order —
 * not the claim order — and hands back the record each module slices its
 * view from: `prisma` before `clickhouse`/`objectStorage`, `redis` before its members.
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
