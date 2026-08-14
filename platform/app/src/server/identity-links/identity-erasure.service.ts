import {
  canonicalizeEmailLike,
  EMAIL_EXTERNAL_KINDS,
  isEmailKind,
} from "@langwatch/identity-links";

import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { IdentityErasureTokenService } from "~/server/identity-links/erasure-token.service";
import { PrismaIdentityLinkStorage } from "~/server/identity-links/prisma-identity-link-storage";
import {
  eraseSnapshotPersonReferences,
  type PersonIdentifiers,
} from "~/server/identity-links/snapshot-erasure";
import type { TransactionClient } from "~/server/users/close-open-links";

/**
 * What erasure would touch, per category. Returned by the dry run and by the
 * execution, so an operator compares the same shape before and after.
 */
export interface IdentityErasureCounts {
  /** Link rows naming the person, as subject or as the admin who acted. */
  linkRows: number;
  /** `OrganizationUser` rows in this organization whose directory anchor is set. */
  directoryAnchors: number;
  /** `DiscoveredAgent` rows whose snapshot mentions the person. */
  agentSnapshots: number;
}

export interface IdentityErasurePreview extends IdentityErasureCounts {
  organizationId: string;
  userId: string;
  /**
   * How many distinct email-shaped login ids would be swapped for a token.
   * Named separately from `linkRows` because it is the irreversible half: a
   * blanked `userId` could in principle be re-linked by an admin, a hashed
   * email cannot be recovered by anyone.
   */
  emailLoginsTokenized: number;
}

export interface IdentityErasureResult extends IdentityErasureCounts {
  organizationId: string;
  userId: string;
  erasedAt: Date;
}

/**
 * Right-to-be-forgotten for one person in one organization (ADR-094 Decision
 * 9).
 *
 * It erases WHO THEY WERE and never WHICH ROWS EXIST. Every link row stays
 * exactly where it is, keeping its dates and its non-email login ids, so no
 * timeline shortens, no superseded link comes back into force, nobody else's
 * attribution moves, and last quarter's published totals still add up. What
 * goes is the person: `userId`, `actorUserId` wherever it names them,
 * email-shaped login ids (swapped for a re-derivable token so the report can
 * still recognise the timeline), the directory anchor, and person references
 * inside discovered-agent snapshots.
 *
 * IRREVERSIBLE, so the surface is built around that rather than apologising
 * for it: {@link preview} counts and writes nothing, {@link erase} refuses
 * without an explicit confirmation, and everything the execution does happens
 * in ONE transaction — a half-erased person is worse than an un-erased one,
 * because nobody can tell which half.
 *
 * `erasedAt` is stamped from the real clock. It is a fact about when the rows
 * were rewritten, not a label somebody chose; batch 2 learned that lesson on
 * the backoffice deactivation date and it applies with more force here, where
 * the stamp is the only thing distinguishing "person forgotten" from "admin
 * unlinked" forever.
 */
export class IdentityErasureService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: IdentityErasureTokenService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static create(prisma: PrismaClient): IdentityErasureService {
    return new IdentityErasureService(
      prisma,
      IdentityErasureTokenService.fromEnv(),
    );
  }

  /**
   * Count what erasure would touch, writing nothing (Gates: "count-first dry
   * run printed before execution"). The operator sees these numbers before
   * {@link erase} will do anything at all.
   */
  async preview({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<IdentityErasurePreview> {
    const plan = await this.plan({ tx: this.prisma, organizationId, userId });
    return {
      organizationId,
      userId,
      linkRows: plan.linkRowsTouched,
      directoryAnchors: plan.anchoredMemberships.length,
      agentSnapshots: plan.agentRewrites.length,
      emailLoginsTokenized: plan.emailTokens.size,
    };
  }

  /**
   * Erase the person. Requires `confirm: true` — a caller that forgot to ask
   * the operator gets a refusal, not a destroyed identity.
   */
  async erase({
    organizationId,
    userId,
    confirm,
  }: {
    organizationId: string;
    userId: string;
    confirm: boolean;
  }): Promise<IdentityErasureResult> {
    if (!confirm) {
      throw new Error(
        "Identity erasure requires an explicit confirmation — run the dry run first and pass confirm",
      );
    }

    const erasedAt = this.now();

    return await this.prisma.$transaction(async (tx) => {
      // Re-planned inside the transaction rather than reusing the dry run's
      // result: the counts an operator saw are a decision aid, never the
      // instruction set. Anything appended in between must still be erased.
      const plan = await this.plan({ tx, organizationId, userId });

      const { linkRowsTouched } = await new PrismaIdentityLinkStorage(
        tx as PrismaClient,
      ).eraseIdentifiers({
        organizationId,
        userId,
        emailTokenByExternalId: plan.emailTokens,
        erasedAt,
      });

      // The anchor is a mutable pointer with no history, so it gets no
      // `erasedAt` marker: blank-after-erasure and never-set are the same
      // state and there is no timeline to audit (ADR-094 Decision 9).
      // `updateMany` is scoped to this organization only — a person's
      // membership of another organization is not this request's business.
      // Scoped to rows that actually carry an anchor, so the count reports
      // what was blanked rather than how many membership rows were visited —
      // the operator is comparing it against the dry run.
      const { count: directoryAnchors } = await tx.organizationUser.updateMany({
        where: {
          organizationId,
          userId,
          OR: [{ externalId: { not: null } }, { scimSource: { not: null } }],
        },
        data: { externalId: null, scimSource: null },
      });

      for (const rewrite of plan.agentRewrites) {
        await tx.discoveredAgent.update({
          where: { id: rewrite.id },
          data: {
            snapshot: rewrite.snapshot as Prisma.InputJsonValue,
            erasedAt,
          },
        });
      }

      return {
        organizationId,
        userId,
        erasedAt,
        linkRows: linkRowsTouched,
        directoryAnchors,
        agentSnapshots: plan.agentRewrites.length,
      };
    });
  }

  /**
   * Everything erasure needs to know, read once so the dry run and the
   * execution answer from the same query rather than from two descriptions of
   * one intent that can drift apart.
   */
  private async plan({
    tx,
    organizationId,
    userId,
  }: {
    tx: TransactionClient;
    organizationId: string;
    userId: string;
  }) {
    const linkRows = await tx.providerIdentityLink.findMany({
      where: { organizationId, OR: [{ userId }, { actorUserId: userId }] },
      select: { externalKind: true, externalId: true },
    });

    // Only rows that NAME the person get tokenized: the emails come from the
    // person's own links and their account, never from every email-kind row in
    // the organization, or erasing one person would blank a colleague's login.
    const emailTokens = this.tokens.tokensFor({
      organizationId,
      emails: linkRows
        .filter((row) => isEmailKind(row.externalKind))
        .map((row) => row.externalId),
    });

    const anchoredMemberships = await tx.organizationUser.findMany({
      where: { organizationId, userId },
      select: { externalId: true, scimSource: true },
    });

    const account = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    const identifiers: PersonIdentifiers = {
      userId,
      emails: [
        ...emailTokens.keys(),
        ...(account?.email ? [canonicalizeEmailLike(account.email)] : []),
      ],
      providerActorIds: [
        ...new Set(
          linkRows
            .filter((row) => !isEmailKind(row.externalKind))
            .map((row) => row.externalId),
        ),
        ...anchoredMemberships
          .map((membership) => membership.externalId)
          .filter((externalId): externalId is string => externalId !== null),
      ],
    };

    const agents = await tx.discoveredAgent.findMany({
      where: { organizationId },
      select: { id: true, snapshot: true },
    });

    // Counted with the SAME predicate the storage erases by, which is wider
    // than "rows naming the person": a row carrying one of their email logins
    // is erased even when its `userId` was already closed out, because the
    // email itself is the identifier. Counting the narrow set here would show
    // the operator a smaller number than the execution goes on to touch.
    const linkRowsTouched = await tx.providerIdentityLink.count({
      where: {
        organizationId,
        OR: [
          { userId },
          { actorUserId: userId },
          ...(emailTokens.size === 0
            ? []
            : [
                {
                  externalKind: { in: [...EMAIL_EXTERNAL_KINDS] },
                  externalId: { in: [...emailTokens.keys()] },
                },
              ]),
        ],
      },
    });

    const agentRewrites = agents.flatMap((agent) => {
      const { snapshot, changed } = eraseSnapshotPersonReferences(
        agent.snapshot,
        identifiers,
      );
      return changed ? [{ id: agent.id, snapshot }] : [];
    });

    return {
      linkRowsTouched,
      emailTokens,
      anchoredMemberships: anchoredMemberships.filter(
        (membership) =>
          membership.externalId !== null || membership.scimSource !== null,
      ),
      agentRewrites,
    };
  }
}
