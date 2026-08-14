import {
  type IdentityLinkRow,
  type LoginRef,
  resolveOwnerAt,
} from "@langwatch/identity-links";

import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaIdentityLinkStorage } from "~/server/identity-links/prisma-identity-link-storage";

/** A `PrismaClient` or an interactive-transaction client from `$transaction`. */
export type TransactionClient = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

const loginKey = (login: LoginRef): string =>
  [
    login.provider,
    login.providerConnectionId,
    login.externalKind,
    login.externalId,
  ].join(" ");

const groupByLogin = (
  rows: readonly IdentityLinkRow[],
): Map<string, IdentityLinkRow[]> => {
  const timelines = new Map<string, IdentityLinkRow[]>();
  for (const row of rows) {
    const key = loginKey(row);
    const timeline = timelines.get(key);
    if (timeline) timeline.push(row);
    else timelines.set(key, [row]);
  }
  return timelines;
};

/**
 * Does this login's timeline still land on this person, right now?
 *
 * Resolved at wall-clock `now` — the same instant the closing row will carry —
 * and NOT at the timeline's own latest `effectiveFrom`. Those two agreed only
 * as long as nobody could date a row into the future. Now that the admin
 * surface allows any `effectiveFrom` (backdating is how corrections work), a
 * link dated for next quarter would drag the evaluation point forward with it
 * and answer a question nobody asked: an offboarding today would consult the
 * ownership that has not started yet, decide the person no longer holds the
 * login, and skip the closing row their membership ending requires.
 *
 * `resolveOwnerAt(rows, now)` ignores future rows by construction, so the
 * answer is about today. A future row that hands the login to somebody else is
 * left standing: closing what the person holds today never reaches forward to
 * cancel a handover an admin has already scheduled.
 */
const stillOwnedBy = (
  timeline: readonly IdentityLinkRow[],
  userId: string,
  now: Date,
): boolean => {
  const owner = resolveOwnerAt(timeline, now);
  return owner.kind === "person" && owner.userId === userId;
};

/**
 * Append one closing row per provider login this person still owns in this
 * organization (ADR-094 Decision 4). Returns how many were appended.
 *
 * It takes a transaction client rather than a Prisma client on purpose: the
 * ADR bans appending after the membership change commits, because a crash in
 * that gap loses the closing row forever. Every caller runs this inside the
 * same transaction as its own membership write — which is also why the
 * membership write is NOT here: each entry point owns its own guards (the
 * seat path holds a last-admin lock in that transaction) and this function
 * has no business unlocking them.
 *
 * "Still owns" is the timeline's answer AT `now`, not a `userId` match: the
 * winning row for (provider, connection, kind, id) as of this instant —
 * `effectiveFrom DESC, seq DESC` among rows already in force — has to resolve
 * to this person. A login they held and an admin has since reassigned belongs
 * to somebody else now, and closing it would take that person's money away.
 *
 * That check is also what makes this idempotent, which the reconciliation
 * sweep depends on: after one pass the latest row is the unlink, so a second
 * pass appends nothing.
 */
export const closeOpenLinksForMembership = async ({
  tx,
  organizationId,
  userId,
  actorUserId,
  now,
}: {
  tx: TransactionClient;
  organizationId: string;
  userId: string;
  /** The admin behind the change; null for directory traffic and sweeps. */
  actorUserId: string | null;
  now: Date;
}): Promise<number> => {
  // Indexed by @@index([organizationId, userId]).
  const held = await tx.providerIdentityLink.findMany({
    where: { organizationId, userId },
    select: {
      provider: true,
      providerConnectionId: true,
      externalKind: true,
      externalId: true,
    },
    distinct: [
      "provider",
      "providerConnectionId",
      "externalKind",
      "externalId",
    ],
  });
  if (held.length === 0) return 0;

  const storage = new PrismaIdentityLinkStorage(tx as PrismaClient);
  const rows = await storage.listLinksForLogins(organizationId, held);

  const timelines = groupByLogin(rows);

  let closed = 0;
  for (const login of held) {
    const timeline = timelines.get(loginKey(login)) ?? [];
    if (!stillOwnedBy(timeline, userId, now)) continue;

    await storage.appendLink({
      organizationId,
      provider: login.provider,
      providerConnectionId: login.providerConnectionId,
      externalKind: login.externalKind,
      externalId: login.externalId,
      userId: null,
      effectiveFrom: now,
      source: "offboarding",
      actorUserId,
    });
    closed += 1;
  }

  return closed;
};
