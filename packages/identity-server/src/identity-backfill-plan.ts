import {
  arrivalStateForProvider,
  type ExpectedIdentifier,
  identifierProviderFor,
  normalizeIdentifierValue,
} from "@langwatch/identity";
import { deriveIdentifierId } from "./crypto/identifier-identity";
import type {
  BackfillAccountRow,
  BackfillUserRow,
} from "./identity-backfill.repository";
import {
  adoptAccountCommandId,
  adoptUserEmailCommandId,
} from "./identity-command-id";

/**
 * What the legacy rows IMPLY — the plan a backfill pass states, and the
 * same plan the parity check proves the projection against (ADR-101 §6).
 *
 * Its own module for the reason `offboard.ts` is its own module in authz:
 * this is a different shape of work from the service's steps. The service
 * sequences effects (adopt, establish, compensate, prove); this is a pure
 * function of two row sets, and keeping it here is what lets the parity
 * check and the adoption loop read the same plan rather than two
 * derivations that must be kept in agreement by hand.
 *
 * Every id in the plan is derived, none minted: the identifier ids come
 * from `deriveIdentifierId` over the row's own content, and the command
 * ids from `identity-command-id.ts`. That is what makes the pass restatable
 * — a second pass over unchanged rows produces a byte-identical plan.
 */

/** One identifier the legacy rows imply, with the command that adopts it. */
export type PlannedIdentifier = ExpectedIdentifier & {
  commandId: string;
  accountId: string | null;
  providerAccountId: string | null;
  occurredAtMs: number;
};

/**
 * The email identifier from `User.email` (VERIFIED when `emailVerified`),
 * plus one identifier per `Account` row in the state its provider arrives
 * in (R8). Business time is each row's own `createdAt`, so live emission of
 * the same fact derives the same identifier id.
 */
export function planIdentifiers({
  user,
  accounts,
}: {
  user: BackfillUserRow & { email: string };
  accounts: BackfillAccountRow[];
}): PlannedIdentifier[] {
  const normalizedValue = normalizeIdentifierValue(user.email);
  const planned = [
    {
      provider: "email" as const,
      providerAccountId: null,
      accountId: null,
      occurredAtMs: user.createdAtMs,
      commandId: adoptUserEmailCommandId({ userId: user.id }),
      value: normalizedValue,
      expectedState: user.emailVerified
        ? ("VERIFIED" as const)
        : ("ATTACHED" as const),
    },
    ...accounts.map((account) => {
      const provider = identifierProviderFor(account.provider);
      return {
        provider,
        providerAccountId: account.providerAccountId,
        accountId: account.id,
        occurredAtMs: account.createdAtMs,
        commandId: adoptAccountCommandId({ accountId: account.id }),
        value: normalizedValue,
        expectedState: arrivalStateForProvider(provider),
      };
    }),
  ];
  return planned.map((plan) => ({
    ...plan,
    identifierId: deriveIdentifierId({
      userId: user.id,
      provider: plan.provider,
      providerAccountId: plan.providerAccountId,
      normalizedValue,
      occurredAtMs: plan.occurredAtMs,
    }),
  }));
}
