// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Which gateway keys a connected provider bill pays for, and moving one key
 * from one bill to another without leaving a moment uncovered (ADR-128 §7).
 *
 * The database holds the rule that a key has at most one OPEN bill at a time.
 * What it cannot hold is CONTINUITY: no uniqueness rule can see a gap. Two
 * administrators editing through independent updates could close a key's
 * coverage and open its successor an hour later, leaving an hour of that
 * key's spend covered by no bill, with nothing raised and nothing to find it
 * afterwards. So re-pointing is never two writes — it is one transaction that
 * locks the open row, closes it and opens the successor at the same instant.
 * That same shape is what keeps CLOSED history non-overlapping: a closed row
 * is only ever written by closing the open row, never inserted directly.
 * Continuity is the transaction's job; the constraints cover only the errors a
 * correct transaction can still make.
 *
 * Spec: specs/governance/governance-cost-coverage.feature
 */
import type { PrismaClient } from "~/generated/prisma/client";

import {
  type CoveragePeriod,
  IngestionSourceKeyCoverageRepository,
} from "../repositories/ingestionSourceKeyCoverage.repository";
import {
  CoverageDayNotADateError,
  CoverageStartNotAfterCurrentError,
  CoverageStartNotMidnightError,
  GatewayKeyAlreadyCoveredError,
  GatewayKeyNotMappableError,
} from "./costCoverage.errors";
import {
  coverageOnDay,
  isCalendarDay,
  isUtcMidnight,
} from "./logic/costCoverage";
import {
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
} from "./logic/postgresConstraintErrors";

export class CostCoverageService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: IngestionSourceKeyCoverageRepository = new IngestionSourceKeyCoverageRepository(),
  ) {}

  static create(prisma: PrismaClient): CostCoverageService {
    return new CostCoverageService(prisma);
  }

  /** Every period this organization has recorded, closed ones included. */
  getAll(params: { organizationId: string }): Promise<CoveragePeriod[]> {
    return this.repo.findAllByOrganization(this.prisma, params);
  }

  /** One bill's periods, for the list shown beside its configuration. */
  getAllBySource(params: {
    organizationId: string;
    ingestionSourceId: string;
  }): Promise<CoveragePeriod[]> {
    return this.repo.findAllBySource(this.prisma, params);
  }

  /**
   * Which bill covered each of the organization's keys on one UTC day: key id
   * to ingestion source id. A key absent from the map is unmapped that day, and
   * its gateway spend stands alone as metered.
   *
   * Reads the whole history and resolves in memory rather than filtering the
   * day in SQL: the mapping is a small administrator-curated list — tens of rows
   * for an organization with a lot of keys — so the day costs nothing to
   * resolve here and the query stays one the index already serves. Drawing a
   * window of days through this method reads that list once per day; a caller
   * doing so should read the periods once and call `coverageOnDay` itself.
   */
  async getCoverageOnDay(params: {
    organizationId: string;
    day: string;
  }): Promise<Map<string, string>> {
    if (!isCalendarDay(params.day)) {
      throw new CoverageDayNotADateError(params.day);
    }
    const periods = await this.repo.findAllByOrganization(this.prisma, {
      organizationId: params.organizationId,
    });
    return coverageOnDay({ periods, day: params.day });
  }

  /**
   * Records a bill as covering a key from a UTC midnight onward, moving the key
   * off whatever bill covered it before.
   *
   * One transaction, and the ordering inside it is what makes a gap
   * unrepresentable: the open row is taken `FOR UPDATE` first, so a second
   * administrator's re-point of the same key waits rather than interleaving —
   * and is then refused rather than applied on top, because by the time it wakes
   * the row it locked is closed and its own insert meets the one-open-bill
   * index. Both writes land or neither does.
   *
   * Re-pointing a key to the bill already covering it is a no-op rather than an
   * error: an administrator confirming what is already true has not made a
   * mistake, and closing and reopening the same coverage would put a seam in
   * the history for nothing.
   */
  async pointKeyAtSource(params: {
    organizationId: string;
    virtualKeyId: string;
    ingestionSourceId: string;
    effectiveFrom: Date;
  }): Promise<CoveragePeriod> {
    this.assertMidnight(params.effectiveFrom);
    return await this.mappingConstraints(params, () =>
      this.prisma.$transaction(async (tx) => {
        const open = await this.repo.findOpenForUpdate(tx, {
          organizationId: params.organizationId,
          virtualKeyId: params.virtualKeyId,
        });
        if (open?.ingestionSourceId === params.ingestionSourceId) return open;
        if (open) {
          this.assertAfter({
            open,
            effectiveFrom: params.effectiveFrom,
            virtualKeyId: params.virtualKeyId,
          });
          await this.repo.close(tx, {
            organizationId: params.organizationId,
            id: open.id,
            validTo: params.effectiveFrom,
          });
        }
        return await this.repo.open(tx, {
          organizationId: params.organizationId,
          ingestionSourceId: params.ingestionSourceId,
          virtualKeyId: params.virtualKeyId,
          validFrom: params.effectiveFrom,
        });
      }),
    );
  }

  /**
   * Ends a key's coverage from a UTC midnight, leaving its spend to stand alone
   * as metered from that day on.
   *
   * Deliberately not a delete: the closed row is what keeps last May reading
   * under the bill that covered May.
   */
  async stopCoveringKey(params: {
    organizationId: string;
    virtualKeyId: string;
    effectiveFrom: Date;
  }): Promise<void> {
    this.assertMidnight(params.effectiveFrom);
    await this.mappingConstraints(params, () =>
      this.prisma.$transaction(async (tx) => {
        const open = await this.findOpenAfterAnyRepoint(tx, {
          organizationId: params.organizationId,
          virtualKeyId: params.virtualKeyId,
        });
        if (!open) return;
        this.assertAfter({
          open,
          effectiveFrom: params.effectiveFrom,
          virtualKeyId: params.virtualKeyId,
        });
        await this.repo.close(tx, {
          organizationId: params.organizationId,
          id: open.id,
          validTo: params.effectiveFrom,
        });
      }),
    );
  }

  /**
   * The key's open period, looked for a second time when the first attempt
   * found none.
   *
   * Not defensive repetition — it closes a hole that reports success while
   * doing nothing. Under READ COMMITTED a `SELECT … WHERE "validTo" IS NULL FOR
   * UPDATE` that blocks on a concurrent re-point wakes to re-check the row it
   * waited for, finds the winner has just closed it, and skips it; the
   * successor the winner inserted is not in this statement's snapshot either.
   * So the read comes back empty although the key is very much still covered,
   * and an unguarded caller would commit nothing and tell the administrator the
   * coverage was stopped.
   *
   * The second read is a new statement and so takes a new snapshot, which does
   * see the successor. One retry is enough: it only runs when the first read
   * found nothing, and by then the transaction it lost to has committed.
   *
   * `pointKeyAtSource` needs no such retry — its insert meets the one-open-bill
   * index and is refused in words. Only the path that writes nothing on an
   * empty read can fail silently.
   */
  private async findOpenAfterAnyRepoint(
    tx: Parameters<typeof this.repo.findOpenForUpdate>[0],
    params: { organizationId: string; virtualKeyId: string },
  ): Promise<CoveragePeriod | null> {
    const first = await this.repo.findOpenForUpdate(tx, params);
    if (first) return first;
    return await this.repo.findOpenForUpdate(tx, params);
  }

  private assertMidnight(effectiveFrom: Date): void {
    if (!isUtcMidnight(effectiveFrom)) {
      throw new CoverageStartNotMidnightError(effectiveFrom);
    }
  }

  /**
   * Refuses a change that would close the open period at or before it began.
   *
   * At the same instant the period covers no time at all — checked here before
   * the write, and by the `CHECK` behind it if a race gets past.
   */
  private assertAfter(params: {
    open: CoveragePeriod;
    effectiveFrom: Date;
    virtualKeyId: string;
  }): void {
    if (params.effectiveFrom.getTime() > params.open.validFrom.getTime())
      return;
    throw new CoverageStartNotAfterCurrentError({
      virtualKeyId: params.virtualKeyId,
      currentStartedAt: params.open.validFrom,
    });
  }

  /**
   * Turns the constraint violations this mapping can raise into words an
   * administrator can act on. None of them is caught by the checks above: those
   * run against the state this transaction read, and either a racing writer
   * moves it afterwards or the rule lives somewhere only the database can see.
   *
   * The unique violation is the ordinary race. The `FOR UPDATE` serialises
   * re-points of the SAME key, but two administrators claiming a so-far
   * uncovered key from two different bills each find no open row to lock, so
   * the one-open-bill index is the only thing that sees them collide.
   *
   * The check violation is narrower: the winner of such a race opened its
   * period at the very instant this one is closing at, so the close leaves a
   * period covering no time.
   *
   * The foreign-key violation is not a race at all — it is the row-to-key
   * organization trigger refusing a key that is not this organization's to map,
   * whether because it belongs to another organization or because it no longer
   * exists. Without this branch the commonest real mistake there is, naming a
   * key that has since been deleted, would reach the administrator as a trace
   * id.
   */
  private async mappingConstraints<T>(
    context: { virtualKeyId: string; effectiveFrom: Date },
    write: () => Promise<T>,
  ): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new GatewayKeyAlreadyCoveredError(context.virtualKeyId);
      }
      if (isCheckViolation(error)) {
        throw new CoverageStartNotAfterCurrentError({
          virtualKeyId: context.virtualKeyId,
          currentStartedAt: context.effectiveFrom,
        });
      }
      if (isForeignKeyViolation(error)) {
        throw new GatewayKeyNotMappableError(context.virtualKeyId);
      }
      throw error;
    }
  }
}
