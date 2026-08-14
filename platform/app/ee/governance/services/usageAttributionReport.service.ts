// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ACTOR_ID_KIND_BY_PROVIDER,
  actorKindFromOcsf,
  BACKDATED_ATTRIBUTION_NOTICE,
  canonicalizeEmailLike,
  emailKindsForProvider,
  ERASED_PERSON_DISPLAY_NAME,
  type IdentityLinkRow,
  isPersonKind,
  type LinkProvider,
  type LoginRef,
  type LoginResolution,
  type OwnershipSegment,
  REVISING_PROVIDER_FRESHNESS_COPY,
  type ReportBucket,
  resolveOwnerAt,
  splitPeriodByOwnership,
} from "@langwatch/identity-links";

import { createLogger } from "@langwatch/observability";

import type { PrismaClient } from "~/generated/prisma/client";
import { getClickHouseClientForOrganization } from "~/server/clickhouse/clickhouseClient";
import { IdentityErasureTokenService } from "~/server/identity-links/erasure-token.service";
import { PrismaIdentityLinkStorage } from "~/server/identity-links/prisma-identity-link-storage";

import { PROJECT_KIND } from "./governanceProject.service";
import {
  linkProviderForSourceType,
  REVISING_SOURCE_TYPES,
} from "./usageAttribution.constants";
import {
  type AttributionLedgerRow,
  UsageAttributionLedgerClickHouseRepository,
} from "./usageAttributionLedger.clickhouse.repository";

const logger = createLogger("langwatch:governance:usage-attribution-report");

/** One line of the report: a person, a login nobody has claimed, or a machine. */
export interface AttributionReportRow {
  bucket: ReportBucket;
  /** The person's display name, or the erased-person copy. Null when unresolved. */
  displayName: string | null;
  /** Our user id, when the login resolved to a live person. */
  userId: string | null;
  sourceId: string;
  provider: string | null;
  /** The provider's own id for this actor, as the ledger carries it. */
  actorUserId: string;
  actorEmail: string;
  events: number;
  spendUsd: number;
}

export interface AttributionTotals {
  events: number;
  spendUsd: number;
}

export interface AttributionReport {
  organizationId: string;
  from: Date;
  to: Date;
  rows: AttributionReportRow[];
  /** Per bucket, plus the ledger total the three must add up to. */
  totals: Record<ReportBucket, AttributionTotals> & {
    ledger: AttributionTotals;
  };
  /**
   * Copy for providers that restate their own numbers, present only when the
   * window actually contains such a source.
   */
  freshness: string | null;
  /**
   * Set when a link appended after the last export reaches back into the
   * period that export covered (ADR-094 Decision 3).
   */
  changeNotice: string | null;
}

/** A login as the ledger presents it, before we know whose it is. */
interface LedgerLogin {
  sourceId: string;
  provider: LinkProvider | null;
  actorUserId: string;
  actorEmail: string;
}

const loginKey = (login: LedgerLogin): string =>
  [login.sourceId, login.actorUserId, login.actorEmail].join("\u0000");

const refKey = (ref: LoginRef): string =>
  [
    ref.provider,
    ref.providerConnectionId,
    ref.externalKind,
    ref.externalId,
  ].join("\u0000");

const emptyTotals = (): AttributionTotals => ({ events: 0, spendUsd: 0 });

/**
 * The usage-attribution report (ADR-094 Decisions 2 and 5).
 *
 * It groups the ledger by provider login, asks the link list who owned each
 * login AT THE MOMENT each unit of usage happened, and sorts the result into
 * three buckets that always add back up to the ledger:
 *
 * - **attributed** — the login resolved to a person. An erased person still
 *   resolves; they are shown as "former member (erased)" and their spend stays
 *   exactly where it was, because moving it would change a published total.
 * - **unattributed** — a login that COULD belong to somebody and does not yet.
 *   An admin fixes this by linking.
 * - **unattributable** — a service principal or a bot, declared as such by the
 *   adapter at ingest. Never inferred here from a missing link: "no link yet"
 *   and "can never have one" are different answers, and merging them tells an
 *   admin to go and create a link that cannot exist.
 *
 * Nothing is ever dropped. A row we cannot place is unattributed, which is
 * visible and fixable; the alternative — filtering it out — makes the totals
 * stop matching the ledger and hides the gap while it happens.
 */
export class UsageAttributionReportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ledger: UsageAttributionLedgerClickHouseRepository,
    /**
     * Null when the instance has no erasure secret configured. The report
     * still runs; it simply builds no erased-token refs, because there is no
     * key to derive them with. An instance that has actually erased somebody
     * necessarily had the key — erasure refuses without it — so this is the
     * never-erased case, not a silent loss.
     */
    private readonly tokens: IdentityErasureTokenService | null,
  ) {}

  async report({
    organizationId,
    tenantId,
    from,
    to,
  }: {
    organizationId: string;
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<AttributionReport> {
    const ledgerRows = await this.ledger.findLedger({ tenantId, from, to });
    const sources = await this.loadSources({ organizationId, ledgerRows });

    const rows: AttributionReportRow[] = [];
    const personRows: Array<{ row: AttributionLedgerRow; login: LedgerLogin }> =
      [];

    for (const row of ledgerRows) {
      const source = sources.get(row.sourceId);
      const provider = source
        ? linkProviderForSourceType(source.sourceType)
        : null;

      // The bucket comes from what the adapter declared at ingest, and from
      // nothing else (Decision 5).
      const actorKind = actorKindFromOcsf({
        type: row.actorType,
        type_id: row.actorTypeId,
      });
      if (!isPersonKind(actorKind)) {
        rows.push(this.toRow(row, provider, "unattributable", null, null));
        continue;
      }

      const login: LedgerLogin = {
        sourceId: row.sourceId,
        provider,
        actorUserId: row.actorUserId,
        actorEmail: row.actorEmail,
      };

      // A person-kind row carrying no identifier at all cannot be linked and
      // cannot be a machine either. It stays UNATTRIBUTED — counted, visible,
      // and honest about the fact that the adapter told us nothing.
      if (row.actorUserId === "" && row.actorEmail === "") {
        rows.push(this.toRow(row, provider, "unattributed", null, null));
        continue;
      }

      personRows.push({ row, login });
    }

    const timelines = await this.loadTimelines({
      organizationId,
      logins: personRows.map(({ login }) => login),
    });

    // Split once per LOGIN, not once per ledger row: the split depends on the
    // login's timeline and the window, neither of which varies per row.
    const segmentsByLogin = new Map<string, OwnershipSegment[]>();
    for (const { login } of personRows) {
      const key = loginKey(login);
      if (segmentsByLogin.has(key)) continue;
      segmentsByLogin.set(
        key,
        this.segments({ organizationId, timelines, login, from, to }),
      );
    }

    const resolutionFor = (
      login: LedgerLogin,
      firstEventMs: number,
    ): LoginResolution =>
      resolutionAt(segmentsByLogin.get(loginKey(login)) ?? [], firstEventMs);

    const resolvedUserIds = new Set<string>();
    for (const { row, login } of personRows) {
      const resolution = resolutionFor(login, row.firstEventMs);
      if (resolution.kind === "person") resolvedUserIds.add(resolution.userId);
    }

    const names = await this.loadDisplayNames(resolvedUserIds);

    for (const { row, login } of personRows) {
      const resolution = resolutionFor(login, row.firstEventMs);
      rows.push(
        this.toRow(
          row,
          login.provider,
          bucketFor(resolution),
          displayNameFor(resolution, names),
          resolution.kind === "person" ? resolution.userId : null,
        ),
      );
    }

    return {
      organizationId,
      from,
      to,
      rows: mergeRows(rows),
      totals: totalsOf(rows),
      freshness: this.freshnessFor(sources, ledgerRows),
      changeNotice: await this.changeNoticeFor(organizationId),
    };
  }

  /**
   * Ownership segments for one login across the window — what the report can
   * show as "this login was A's until the 15th, B's after".
   *
   * Exposed because the segments and the money must be computed from the same
   * split: a UI that showed one and totalled the other would eventually
   * disagree with itself.
   */
  async segmentsForLogin({
    organizationId,
    login,
    from,
    to,
  }: {
    organizationId: string;
    login: LedgerLogin;
    from: Date;
    to: Date;
  }): Promise<OwnershipSegment[]> {
    const timelines = await this.loadTimelines({
      organizationId,
      logins: [login],
    });
    return this.segments({ organizationId, timelines, login, from, to });
  }

  /**
   * Record that this window was reported, and hand back the report that was
   * reported. One call, so an export can never claim a period it did not
   * actually produce numbers for.
   */
  async export({
    organizationId,
    tenantId,
    from,
    to,
    actorUserId,
  }: {
    organizationId: string;
    tenantId: string;
    from: Date;
    to: Date;
    actorUserId: string;
  }): Promise<AttributionReport> {
    const report = await this.report({ organizationId, tenantId, from, to });
    await this.prisma.attributionReportExport.create({
      data: {
        organizationId,
        periodFrom: from,
        periodTo: to,
        // From the session. A caller-supplied actor would let somebody sign
        // an export with a colleague's name.
        actorUserId,
      },
    });
    return report;
  }

  /**
   * Every ingestion source the window mentions, in ONE query.
   *
   * Batched rather than looked up per row on purpose: a window's rows are
   * mostly the same handful of connections, and asking per row turns a report
   * into thousands of identical round trips. The `organizationId` predicate
   * travels with the id list — a `SourceId` is a ClickHouse value and must
   * never be trusted to name a connection this organization owns.
   */
  private async loadSources({
    organizationId,
    ledgerRows,
  }: {
    organizationId: string;
    ledgerRows: readonly AttributionLedgerRow[];
  }): Promise<Map<string, { id: string; sourceType: string }>> {
    const sourceIds = [...new Set(ledgerRows.map((row) => row.sourceId))].filter(
      (id) => id !== "",
    );
    if (sourceIds.length === 0) return new Map();

    const sources = await this.prisma.ingestionSource.findMany({
      where: { id: { in: sourceIds }, organizationId },
      select: { id: true, sourceType: true },
    });
    return new Map(sources.map((source) => [source.id, source]));
  }

  /**
   * Every candidate login's timeline, in ONE storage call.
   *
   * Three refs are built per login where the data allows: the TYPED id (the
   * provider's own immutable id, in the namespace that provider declares), the
   * EMAIL id, and the same email's ERASED TOKEN.
   *
   * The token ref is what keeps an erased person attributed. Erasure swapped
   * their email-kind login id for a keyed hash, but ClickHouse still holds the
   * raw address until its TTL expires — so the report derives the identical
   * hash here and finds the timeline that would otherwise have vanished.
   * Deriving it IN MEMORY is load-bearing: the key must never travel into a
   * ClickHouse query parameter, where it would end up in query logs.
   */
  private async loadTimelines({
    organizationId,
    logins,
  }: {
    organizationId: string;
    logins: readonly LedgerLogin[];
  }): Promise<Map<string, IdentityLinkRow[]>> {
    const refs = new Map<string, LoginRef>();
    for (const login of logins) {
      for (const ref of this.refsFor({ organizationId, login })) {
        refs.set(refKey(ref), ref);
      }
    }
    if (refs.size === 0) return new Map();

    const storage = new PrismaIdentityLinkStorage(this.prisma);
    const rows = await storage.listLinksForLogins(organizationId, [
      ...refs.values(),
    ]);

    const byRef = new Map<string, IdentityLinkRow[]>();
    for (const row of rows) {
      const key = refKey(row);
      const existing = byRef.get(key);
      if (existing) existing.push(row);
      else byRef.set(key, [row]);
    }
    return byRef;
  }

  /**
   * The candidate refs one ledger login could match, at most three per email
   * kind: the typed id, the canonical address, and that address's erased
   * token.
   */
  private refsFor({
    organizationId,
    login,
  }: {
    organizationId: string;
    login: LedgerLogin;
  }): LoginRef[] {
    if (!login.provider) return [];
    const refs: LoginRef[] = [];

    const typedKind = ACTOR_ID_KIND_BY_PROVIDER[
      login.provider as keyof typeof ACTOR_ID_KIND_BY_PROVIDER
    ] as string | undefined;
    if (typedKind && login.actorUserId !== "") {
      refs.push({
        provider: login.provider,
        providerConnectionId: login.sourceId,
        externalKind: typedKind,
        externalId: login.actorUserId,
      });
    }

    if (login.actorEmail !== "") {
      const canonical = canonicalizeEmailLike(login.actorEmail);
      const token = this.tokens?.tokenFor({ organizationId, email: canonical });
      for (const kind of emailKindsForProvider(login.provider)) {
        refs.push({
          provider: login.provider,
          providerConnectionId: login.sourceId,
          externalKind: kind,
          externalId: canonical,
        });
        if (token === undefined) continue;
        refs.push({
          provider: login.provider,
          providerConnectionId: login.sourceId,
          externalKind: kind,
          externalId: token,
        });
      }
    }

    return refs;
  }

  /**
   * Who owned this login at this moment?
   *
   * The TYPED timeline decides whenever it covers the moment at all — even
   * when it says "unlinked". That is the point of a typed id: it is the
   * provider's own immutable handle, and an admin who closed it has answered
   * the question. Email timelines are consulted only where the typed one is
   * silent, because an address is the weaker evidence — people get renamed and
   * addresses get recycled, which is the failure that killed two earlier
   * designs of this feature.
   *
   * Among email timelines (the raw address and the erased token are two refs
   * for the same person), the merged set is resolved as one: an erasure does
   * not start a new timeline, it rewrites the ids on the existing one.
   */
  private segments({
    organizationId,
    timelines,
    login,
    from,
    to,
  }: {
    organizationId: string;
    timelines: Map<string, IdentityLinkRow[]>;
    login: LedgerLogin;
    from: Date;
    to: Date;
  }): OwnershipSegment[] {
    const refs = this.refsFor({ organizationId, login });
    const typedKind = ACTOR_ID_KIND_BY_PROVIDER[
      login.provider as keyof typeof ACTOR_ID_KIND_BY_PROVIDER
    ] as string | undefined;

    const typed: IdentityLinkRow[] = [];
    const email: IdentityLinkRow[] = [];
    for (const ref of refs) {
      const rows = timelines.get(refKey(ref)) ?? [];
      if (typedKind && ref.externalKind === typedKind) typed.push(...rows);
      else email.push(...rows);
    }

    const typedSegments = splitPeriodByOwnership(typed, from, to);
    if (email.length === 0) return typedSegments;

    // Cut at every boundary either timeline introduces, then let precedence
    // decide each slice — so a typed row appearing mid-window takes over from
    // the email evidence exactly when it starts, not a segment early or late.
    const cuts = [
      ...new Set(
        [from, ...typed, ...email]
          .map((entry) =>
            entry instanceof Date ? entry.getTime() : entry.effectiveFrom.getTime(),
          )
          .filter((t) => t >= from.getTime() && t < to.getTime()),
      ),
    ].sort((a, b) => a - b);

    const merged: OwnershipSegment[] = [];
    for (const [index, cut] of cuts.entries()) {
      const end = index + 1 < cuts.length ? new Date(cuts[index + 1]!) : to;
      const at = new Date(cut);
      const typedResolution = resolveOwnerAt(typed, at);
      const resolution =
        typedResolution.kind === "none" ? resolveOwnerAt(email, at) : typedResolution;

      const last = merged[merged.length - 1];
      if (last && sameResolution(last.resolution, resolution)) {
        last.to = end;
      } else {
        merged.push({ from: at, to: end, resolution });
      }
    }
    return merged;
  }

  /** Display names for the people the window resolved to, in ONE query. */
  private async loadDisplayNames(
    userIds: ReadonlySet<string>,
  ): Promise<Map<string, string>> {
    if (userIds.size === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true, email: true },
    });
    return new Map(
      users.map((user) => [user.id, user.name ?? user.email ?? user.id]),
    );
  }

  private freshnessFor(
    sources: Map<string, { sourceType: string }>,
    ledgerRows: readonly AttributionLedgerRow[],
  ): string | null {
    const present = ledgerRows.some((row) => {
      const sourceType = sources.get(row.sourceId)?.sourceType;
      return sourceType !== undefined && REVISING_SOURCE_TYPES.includes(sourceType);
    });
    return present ? REVISING_PROVIDER_FRESHNESS_COPY : null;
  }

  /**
   * Has a link appended since the last export reached back into what that
   * export already reported?
   *
   * Both halves are needed. A row appended after the export but effective
   * afterwards changes nothing that was published; a row effective in the past
   * that was appended BEFORE the export was already in the numbers. Only the
   * overlap rewrites history, and that is the one that has to announce itself.
   */
  private async changeNoticeFor(organizationId: string): Promise<string | null> {
    const lastExport = await this.prisma.attributionReportExport.findFirst({
      where: { organizationId },
      orderBy: { exportedAt: "desc" },
      select: { exportedAt: true, periodTo: true },
    });
    if (!lastExport) return null;

    const backdated = await this.prisma.providerIdentityLink.count({
      where: {
        organizationId,
        recordedAt: { gt: lastExport.exportedAt },
        effectiveFrom: { lt: lastExport.periodTo },
      },
    });
    return backdated > 0 ? BACKDATED_ATTRIBUTION_NOTICE : null;
  }

  private toRow(
    row: AttributionLedgerRow,
    provider: LinkProvider | null,
    bucket: ReportBucket,
    displayName: string | null,
    userId: string | null,
  ): AttributionReportRow {
    return {
      bucket,
      displayName,
      userId,
      sourceId: row.sourceId,
      provider,
      actorUserId: row.actorUserId,
      actorEmail: row.actorEmail,
      events: row.events,
      spendUsd: row.spendUsd,
    };
  }
}

/**
 * Which ownership segment does this moment fall in?
 *
 * Reading the answer off the SAME segments the report displays is what keeps
 * the two honest: a UI that showed "A until the 15th, B after" while the money
 * had been bucketed by some other rule would eventually disagree with itself,
 * and there would be no way to tell which half was lying.
 *
 * A moment no segment covers is `none` — the unattributed bucket. That happens
 * when no link row covers it, which is exactly what "nobody has claimed this
 * login yet" means.
 */
const resolutionAt = (
  segments: readonly OwnershipSegment[],
  atMs: number,
): LoginResolution =>
  segments.find(
    (segment) =>
      segment.from.getTime() <= atMs && atMs < segment.to.getTime(),
  )?.resolution ?? { kind: "none" };

/**
 * Wire the report to one organization's governance tenant, or say it cannot be
 * built.
 *
 * Null means "there is nothing to report", not "something failed": an
 * organization with no hidden governance project has never ingested a
 * governance event, and an instance with no ClickHouse has no ledger at all.
 * Both are the empty state every other governance read short-circuits to
 * rather than an error the caller has to handle.
 */
export const createUsageAttributionReportService = async ({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId: string;
}): Promise<{
  service: UsageAttributionReportService;
  tenantId: string;
} | null> => {
  const govProject = await prisma.project.findFirst({
    where: {
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      team: { organizationId },
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!govProject) return null;

  const client = await getClickHouseClientForOrganization(organizationId);
  if (!client) return null;

  const tokens = IdentityErasureTokenService.fromEnvOrNull();
  if (!tokens) {
    logger.warn(
      { organizationId },
      "LW_IDENTITY_ERASURE_SECRET is not set — the usage-attribution report cannot re-derive erased-email tokens, so any erased person's timeline will read as unattributed",
    );
  }

  return {
    tenantId: govProject.id,
    service: new UsageAttributionReportService(
      prisma,
      new UsageAttributionLedgerClickHouseRepository(client),
      tokens,
    ),
  };
};

const sameResolution = (a: LoginResolution, b: LoginResolution): boolean =>
  a.kind === b.kind &&
  (a.kind !== "person" || a.userId === (b as { userId: string }).userId);

const bucketFor = (resolution: LoginResolution): ReportBucket => {
  switch (resolution.kind) {
    case "person":
    // An erased person's timeline still resolves — just to somebody we have
    // been asked to forget. Their spend stays in ATTRIBUTED, because moving
    // it would change totals that were already published (Decision 9).
    case "erased-person":
      return "attributed";
    default:
      return "unattributed";
  }
};

const displayNameFor = (
  resolution: LoginResolution,
  names: ReadonlyMap<string, string>,
): string | null => {
  if (resolution.kind === "erased-person") return ERASED_PERSON_DISPLAY_NAME;
  if (resolution.kind !== "person") return null;
  return names.get(resolution.userId) ?? resolution.userId;
};

/**
 * Collapse the per-trace rows into one line per (bucket, person, login).
 * Conservation is a property of the sum, so merging happens after every row
 * has been placed and never decides where one goes.
 */
const mergeRows = (rows: readonly AttributionReportRow[]): AttributionReportRow[] => {
  const merged = new Map<string, AttributionReportRow>();
  for (const row of rows) {
    const key = [
      row.bucket,
      row.userId ?? "",
      row.sourceId,
      row.actorUserId,
      row.actorEmail,
    ].join("\u0000");
    const existing = merged.get(key);
    if (existing) {
      existing.events += row.events;
      existing.spendUsd += row.spendUsd;
    } else {
      merged.set(key, { ...row });
    }
  }
  return [...merged.values()];
};

const totalsOf = (rows: readonly AttributionReportRow[]) => {
  const totals = {
    attributed: emptyTotals(),
    unattributed: emptyTotals(),
    unattributable: emptyTotals(),
    ledger: emptyTotals(),
  };
  for (const row of rows) {
    totals[row.bucket].events += row.events;
    totals[row.bucket].spendUsd += row.spendUsd;
    totals.ledger.events += row.events;
    totals.ledger.spendUsd += row.spendUsd;
  }
  return totals;
};
