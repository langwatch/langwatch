/**
 * What a module reads and the refusal a process gets when it cannot supply it.
 * Boot builds the union of every module's member declaration, failing eagerly.
 */
import type { StoresMemberSource } from "@langwatch/process-stores";

/** A member a module declared that this process cannot supply. */
export class MissingMemberError extends Error {
  constructor(
    readonly module: string,
    readonly member: string,
    options?: { cause?: unknown },
  ) {
    // The store's own refusal names the setting that would configure it.
    const remedy = options?.cause instanceof Error ? ` ${options.cause.message}` : "";
    super(
      `Module "${module}" reads the "${member}" member, which this process cannot supply.${remedy}`,
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
export function buildClaimedMembers(options: {
  source: StoresMemberSource;
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
      members[name] = options.source.read(name);
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
