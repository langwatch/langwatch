// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ACTOR_ID_KIND_BY_PROVIDER,
  canonicalizeEmailLike,
  canonicalizeExternalId,
  emailKindsForProvider,
  type IdentityLinkRow,
  type LinkProvider,
  type LinkSource,
  type LoginRef,
} from "@langwatch/identity-links";

import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaIdentityLinkStorage } from "~/server/identity-links/prisma-identity-link-storage";

import { linkProviderForSourceType } from "./usageAttribution.constants";

/** What an admin is shown before they decide, never a row that was written. */
export interface LinkSuggestion {
  login: LoginRef;
  userId: string;
  displayName: string;
  /**
   * Why we think so, and the `source` the confirmed link will carry:
   * `external_id` when the provider's own actor id equals the id the customer's
   * directory gave us for a member, `email_suggestion_accepted` when only the
   * addresses match.
   */
  source: Extract<LinkSource, "external_id" | "email_suggestion_accepted">;
  /** One line an admin can act on without opening another tab. */
  evidence: string;
}

/**
 * The admin surface over the add-only link list (ADR-094 Decision 3).
 *
 * Three things it never does, each for a stated reason:
 *
 * - It never EDITS. A correction is a new row that wins the ordering, so the
 *   old answer stays readable and last quarter's report still explains itself.
 * - It never takes the actor from the caller. `actorUserId` comes from the
 *   session at the router, because an actor a person can type is a paper trail
 *   a person can forge.
 * - It never links by itself. {@link suggestionsFor} returns candidates and
 *   stops; an admin confirming one is what writes the row. Automatic matching
 *   is a guess about whose money this is, and guessing is the failure this ADR
 *   was written to prevent.
 */
export class AttributionLinkAdminService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): AttributionLinkAdminService {
    return new AttributionLinkAdminService(prisma);
  }

  /**
   * Append a link. Backdating is allowed and is how corrections work — a
   * backdated row reaching into an already-exported period is not blocked
   * here, it is announced by the next report's change notice.
   *
   * Organization isolation is the storage layer's job and stays there: it
   * checks the connection belongs to this organization before the insert, so a
   * caller naming somebody else's connection is rejected rather than
   * validated twice with two chances to disagree.
   */
  async createLink({
    organizationId,
    login,
    userId,
    effectiveFrom,
    source,
    actorUserId,
  }: {
    organizationId: string;
    login: LoginRef;
    userId: string;
    effectiveFrom: Date;
    source: Extract<
      LinkSource,
      "manual" | "external_id" | "email_suggestion_accepted"
    >;
    actorUserId: string;
  }): Promise<IdentityLinkRow> {
    await this.assertMemberOfOrganization({ organizationId, userId });

    const storage = new PrismaIdentityLinkStorage(this.prisma);
    return await storage.appendLink({
      ...this.canonical(login),
      organizationId,
      userId,
      effectiveFrom,
      source,
      actorUserId,
    });
  }

  /**
   * Close a link — append a row owned by nobody, in force from `effectiveFrom`
   * on. Not a delete: every row before it stays, so the money already reported
   * against this login keeps the owner it was reported with.
   */
  async closeLink({
    organizationId,
    login,
    effectiveFrom,
    actorUserId,
  }: {
    organizationId: string;
    login: LoginRef;
    effectiveFrom: Date;
    actorUserId: string;
  }): Promise<IdentityLinkRow> {
    const storage = new PrismaIdentityLinkStorage(this.prisma);
    return await storage.appendLink({
      ...this.canonical(login),
      organizationId,
      userId: null,
      effectiveFrom,
      // `manual` rather than `offboarding`: a person did this, no membership
      // ended, and the paper trail should not imply one did.
      source: "manual",
      actorUserId,
    });
  }

  /**
   * One login's rows in the ADR's ordering — `effectiveFrom DESC, seq DESC`,
   * so the row in force right now reads first and a same-timestamp correction
   * sits above the row it corrects.
   */
  async listTimeline({
    organizationId,
    login,
  }: {
    organizationId: string;
    login: LoginRef;
  }): Promise<IdentityLinkRow[]> {
    const storage = new PrismaIdentityLinkStorage(this.prisma);
    const rows = await storage.listLinksForLogins(organizationId, [
      this.canonical(login),
    ]);
    return rows.sort(
      (a, b) =>
        b.effectiveFrom.getTime() - a.effectiveFrom.getTime() ||
        Number(b.seq - a.seq),
    );
  }

  /**
   * Candidates for the logins nobody has claimed, drawn from two kinds of
   * evidence that are deliberately not equally strong.
   *
   * The ANCHOR match — the provider's actor id equals the `externalId` the
   * customer's own directory gave us for a member — is near-certain: both
   * sides came from the same identity provider, and it is the match the ADR
   * names `external_id`.
   *
   * The EMAIL match is weaker and is offered as a suggestion precisely because
   * it must never fire on its own. Addresses get recycled; a report that
   * matched on one would eventually hand a departed person's spend to whoever
   * inherited their address, silently and in a money report. An admin looking
   * at the name decides.
   *
   * Both are read-only. Confirming is a separate call.
   */
  async suggestionsFor({
    organizationId,
    unattributed,
  }: {
    organizationId: string;
    unattributed: ReadonlyArray<{
      sourceId: string;
      actorUserId: string;
      actorEmail: string;
    }>;
  }): Promise<LinkSuggestion[]> {
    if (unattributed.length === 0) return [];

    const { sourceById, byAnchor, byEmail } = await this.candidateIndex({
      organizationId,
      sourceIds: [...new Set(unattributed.map((row) => row.sourceId))].filter(
        (id) => id !== "",
      ),
    });

    // Keyed so one login never yields two rows for the same person: an admin
    // offered the same link twice will eventually confirm it twice.
    const suggestions = new Map<string, LinkSuggestion>();
    for (const row of unattributed) {
      const suggestion = this.suggestionFor({
        row,
        sourceById,
        byAnchor,
        byEmail,
      });
      if (suggestion) suggestions.set(suggestionKey(suggestion), suggestion);
    }

    return await this.withoutAlreadyDecided({
      organizationId,
      suggestions: [...suggestions.values()],
    });
  }

  /**
   * Drop suggestions for logins that already have a history.
   *
   * A login an admin deliberately CLOSED resolves to `unlinked`, and the report
   * shows it as unattributed — correctly, since nobody owns it. But the report
   * and this surface would then disagree about what that means: resolution
   * treats a close as an ANSWER (it beats the weaker email evidence), while a
   * suggestion treats it as a GAP. Re-proposing it asks the admin to undo a
   * decision they just made, every time they open the page, until they give in.
   *
   * Only logins with no rows at all are genuinely undecided. Correcting a
   * closed login is still possible — through `createLink` directly, which is
   * the deliberate act it should be.
   */
  private async withoutAlreadyDecided({
    organizationId,
    suggestions,
  }: {
    organizationId: string;
    suggestions: readonly LinkSuggestion[];
  }): Promise<LinkSuggestion[]> {
    if (suggestions.length === 0) return [];

    const storage = new PrismaIdentityLinkStorage(this.prisma);
    const existing = await storage.listLinksForLogins(
      organizationId,
      suggestions.map((suggestion) => suggestion.login),
    );
    const decided = new Set(existing.map((row) => loginRefKey(row)));

    return suggestions.filter(
      (suggestion) => !decided.has(loginRefKey(suggestion.login)),
    );
  }

  /** The one suggestion this ledger row supports, if any. */
  private suggestionFor({
    row,
    sourceById,
    byAnchor,
    byEmail,
  }: {
    row: { sourceId: string; actorUserId: string; actorEmail: string };
    sourceById: ReadonlyMap<string, { sourceType: string }>;
    byAnchor: ReadonlyMap<string, SuggestionMember>;
    byEmail: ReadonlyMap<string, SuggestionMember>;
  }): LinkSuggestion | null {
    const sourceType = sourceById.get(row.sourceId)?.sourceType;
    const provider = sourceType ? linkProviderForSourceType(sourceType) : null;
    if (!provider) return null;

    const match = matchFor({ row, byAnchor, byEmail });
    if (!match) return null;

    const login = this.suggestedLoginRef({
      provider,
      row,
      useAnchor: match.kind === "external_id",
    });
    if (!login) return null;

    return {
      login,
      userId: match.member.userId,
      displayName:
        match.member.user.name ??
        match.member.user.email ??
        match.member.userId,
      source: match.kind,
      evidence:
        match.kind === "external_id"
          ? `Directory id ${row.actorUserId} matches this member's directory record`
          : `Provider address ${row.actorEmail} matches this member's account address`,
    };
  }

  /**
   * Everything the matcher looks a login up in, indexed once.
   *
   * Two queries, never one per row: the candidate set is the whole
   * unattributed list, so per-row lookups would scale with the size of the
   * report rather than with the size of the organization.
   *
   * Members are indexed by their directory id and by their canonical address —
   * the two things a provider's ledger row can be recognised by. Disabled
   * memberships are excluded from SUGGESTIONS (proposing a link to somebody
   * who has left is noise), which is a different rule from `createLink`'s,
   * where a disabled member is still a legitimate target because correcting
   * past attribution is exactly what backdating is for.
   */
  private async candidateIndex({
    organizationId,
    sourceIds,
  }: {
    organizationId: string;
    sourceIds: readonly string[];
  }) {
    const [sources, members] = await Promise.all([
      this.prisma.ingestionSource.findMany({
        where: { id: { in: [...sourceIds] }, organizationId },
        select: { id: true, sourceType: true },
      }),
      this.prisma.organizationUser.findMany({
        where: { organizationId, disabledAt: null },
        select: {
          userId: true,
          externalId: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return {
      sourceById: new Map(sources.map((source) => [source.id, source])),
      byAnchor: new Map(
        members.flatMap((member) =>
          member.externalId === null ? [] : [[member.externalId, member]],
        ),
      ),
      byEmail: new Map(
        members.flatMap((member) =>
          member.user.email === null
            ? []
            : [[canonicalizeEmailLike(member.user.email), member]],
        ),
      ),
    };
  }

  /**
   * Which ref a confirmed suggestion writes.
   *
   * Both branches record the namespace the LEDGER VALUE lives in, never the
   * namespace the evidence came from. That distinction is the whole
   * correctness of this function: the directory anchor is only our reason for
   * believing the match, while the value being linked is the provider's own
   * actor id — and the report joins on the provider's namespace. Storing an
   * anchor match under, say, `scim_external_id` because that is where the
   * directory's copy lives would write a row that silently never matches
   * anything the ledger carries.
   *
   * Which also explains why an anchor match is realistic for Microsoft and
   * rare elsewhere: Entra's objectId is both the directory's id and the id the
   * audit log reports, whereas a Databricks workspace user id and a SCIM
   * external id are simply different numbers for the same person. That is a
   * property of the providers, not a gap to paper over.
   *
   * Null when the provider declares no suitable kind — better to offer no
   * suggestion than one that cannot be joined.
   */
  private suggestedLoginRef({
    provider,
    row,
    useAnchor,
  }: {
    provider: LinkProvider;
    row: { sourceId: string; actorUserId: string; actorEmail: string };
    useAnchor: boolean;
  }): LoginRef | null {
    const externalKind = useAnchor
      ? (ACTOR_ID_KIND_BY_PROVIDER[
          provider as keyof typeof ACTOR_ID_KIND_BY_PROVIDER
        ] as string | undefined)
      : emailKindsForProvider(provider)[0];
    if (!externalKind) return null;

    return {
      provider,
      providerConnectionId: row.sourceId,
      externalKind,
      externalId: useAnchor
        ? row.actorUserId
        : canonicalizeEmailLike(row.actorEmail),
    };
  }

  /**
   * A link may only name somebody who belongs here.
   *
   * `userId` is a plain column with no foreign key (`relationMode="prisma"`),
   * so without this an admin could attach another organization's person to
   * their own spend — and the report would happily print that person's name.
   * Disabled memberships are still memberships: attributing past spend to
   * somebody who has since been offboarded is exactly what a correction is
   * for.
   */
  private async assertMemberOfOrganization({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { organizationId, userId },
      select: { userId: true },
    });
    if (!membership) {
      throw new Error(
        `User ${userId} is not a member of organization ${organizationId}`,
      );
    }
  }

  /**
   * Canonicalize an email-shaped id before it is stored or compared. Skipping
   * this does not fail — it writes a row that quietly never matches, which is
   * the worse outcome.
   */
  private canonical(login: LoginRef): LoginRef {
    return {
      ...login,
      externalId: canonicalizeExternalId(login),
    };
  }
}

/** One member a ledger login might belong to, plus what makes us think so. */
type SuggestionMember = {
  userId: string;
  user: { name: string | null; email: string | null };
};

/**
 * Pick the evidence for one unattributed login.
 *
 * The anchor wins wherever both fire. It is the stronger claim — both sides
 * came from the same identity provider — and offering an admin two rows for
 * one login only invites them to confirm both.
 */
const matchFor = ({
  row,
  byAnchor,
  byEmail,
}: {
  row: { actorUserId: string; actorEmail: string };
  byAnchor: ReadonlyMap<string, SuggestionMember>;
  byEmail: ReadonlyMap<string, SuggestionMember>;
}): {
  member: SuggestionMember;
  kind: "external_id" | "email_suggestion_accepted";
} | null => {
  const anchored =
    row.actorUserId === "" ? undefined : byAnchor.get(row.actorUserId);
  if (anchored) return { member: anchored, kind: "external_id" };

  const addressed =
    row.actorEmail === ""
      ? undefined
      : byEmail.get(canonicalizeEmailLike(row.actorEmail));
  if (addressed) {
    return { member: addressed, kind: "email_suggestion_accepted" };
  }

  return null;
};

const suggestionKey = (suggestion: LinkSuggestion): string =>
  [
    suggestion.login.providerConnectionId,
    suggestion.login.externalKind,
    suggestion.login.externalId,
    suggestion.userId,
  ].join("\u0000");

const loginRefKey = (login: LoginRef): string =>
  [
    login.provider,
    login.providerConnectionId,
    login.externalKind,
    login.externalId,
  ].join("\u0000");
