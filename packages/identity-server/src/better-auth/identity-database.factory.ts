import type { BetterAuthOptions } from "better-auth";
import type { IdentityHeadsRepository } from "../identity-heads.repository";
import { newIdentityCommandId } from "../identity-command-id";
import type { IdentityUsersRepository } from "../identity-users.repository";
import type { IdentityCeremonyWrites } from "../identity-writes";
import { AccountCeremony } from "./account-ceremony";
import { AdapterRows } from "./adapter-rows";
import type { DbAdapter, IdentityWriteGate } from "./adapter-types";
import { IdentityDatabase } from "./identity-database";
import { TransactionWriteGuard } from "./transaction-write-guard";
import { UserCeremony } from "./user-ceremony";
import { WriteRouting } from "./write-routing";

/**
 * The seams the app owns, in the shape `GrantsServiceDeps` uses in authz:
 * ports it implements and closures it composes, never a service this
 * package reaches out for.
 */
export interface IdentityDatabaseDeps {
  /** The row engine: the stock adapter factory the app constructs (the
   *  prismaAdapter over its Prisma client). The facade never sees Prisma. */
  base: (options: BetterAuthOptions) => DbAdapter;
  heads: IdentityHeadsRepository;
  users: IdentityUsersRepository;
  identity: IdentityCeremonyWrites;
  /** The per-user write gate (the app's; ADR-101 §2). */
  isLatched: IdentityWriteGate;
  now?: () => number;
  newCommandId?: () => string;
  /** Substitutable so a test can route a model this deployment does not
   *  mount; production always takes the default table. */
  routing?: WriteRouting;
}

/**
 * better-auth calls its `database` factory once per options instance, and
 * the adapter it gets back lives as long as those options do — so this
 * builds the collaborator graph once, per instance, and hands back an
 * `IdentityDatabase` holding it.
 *
 * Composition only. Every decision this seam makes lives in one of the
 * collaborators: the routing table in `WriteRouting`, what an `Account`
 * write means in `AccountCeremony`, what a `User` write means in
 * `UserCeremony`, the transaction rule in `TransactionWriteGuard`, and the
 * paging/pinning rule in `AdapterRows`.
 */
export function createIdentityDatabase(
  deps: IdentityDatabaseDeps,
): (options: BetterAuthOptions) => DbAdapter {
  const routing = deps.routing ?? new WriteRouting();
  const clock = {
    now: deps.now ?? Date.now,
    newCommandId: deps.newCommandId ?? newIdentityCommandId,
  };
  return (options: BetterAuthOptions): DbAdapter => {
    const base = deps.base(options);
    const rows = new AdapterRows(base);
    return new IdentityDatabase(
      base,
      routing,
      rows,
      new AccountCeremony(
        rows,
        deps.heads,
        deps.identity,
        deps.isLatched,
        clock,
      ),
      new UserCeremony(rows, deps.users, deps.identity, deps.isLatched, clock),
      new TransactionWriteGuard(routing),
    );
  };
}
