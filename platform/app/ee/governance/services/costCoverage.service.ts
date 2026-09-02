// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Which gateway keys a connected provider bill pays for, and moving one key
 * from one bill to another without leaving a moment uncovered (ADR-128 §7).
 *
 * The database holds the rule that a key belongs to one bill at a time. What it
 * cannot hold is CONTINUITY: a non-overlap constraint structurally cannot see a
 * gap. Two administrators editing through independent updates could close a
 * key's coverage and open its successor an hour later, leaving an hour of that
 * key's spend covered by no bill, with nothing raised and nothing to find it
 * afterwards. So re-pointing is never two writes — it is one transaction that
 * locks the open row, closes it and opens the successor at the same instant.
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
  CoverageStartNotAfterCurrentError,
  CoverageStartNotMidnightError,
  GatewayKeyAlreadyCoveredError,
} from "./costCoverage.errors";
import { coverageOnDay, isUtcMidnight } from "./logic/costCoverage";
import {
  isCheckViolation,
  isExclusionViolation,
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
   * day in SQL. The mapping is a small administrator-curated list — tens of rows
   * for an organization with a lot of keys — and the caller draws a window of
   * days, so one read serves all of them where a per-day query would repeat.
   */
  async getCoverageOnDay(params: {
    organizationId: string;
    day: string;
  }): Promise<Map<string, string>> {
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
   * administrator's re-point of the same key waits rather than interleaving.
   * Both writes land or neither does.
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
        const open = await this.repo.findOpenForUpdate(tx, {
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

  private assertMidnight(effectiveFrom: Date): void {
    if (!isUtcMidnight(effectiveFrom)) {
      throw new CoverageStartNotMidnightError(effectiveFrom);
    }
  }

  /**
   * Refuses a change that would close the open period at or before it began.
   *
   * At the same instant the period covers no time at all, which an exclusion
   * constraint cannot see — an empty range overlaps nothing, not even itself —
   * so this is checked before the write and the `CHECK` behind it catches a
   * race.
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
   * Turns the two constraint violations this mapping can raise into words an
   * administrator can act on. Both are losing sides of a race, which is why
   * neither is caught by the checks above: those run against the state this
   * transaction read, and a racing writer moves it afterwards.
   *
   * The exclusion violation is the ordinary one. The `FOR UPDATE` serialises
   * re-points of the SAME key, but two administrators claiming a so-far
   * uncovered key from two different bills each find no open row to lock, so
   * the constraint is the only thing that sees them collide.
   *
   * The check violation is narrower: the winner of such a race opened its
   * period at the very instant this one is closing at, so the close leaves a
   * period covering no time. The instant this transaction was given is
   * therefore also the instant the coverage it lost to begins, which is what
   * the reported date names.
   */
  private async mappingConstraints<T>(
    context: { virtualKeyId: string; effectiveFrom: Date },
    write: () => Promise<T>,
  ): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new GatewayKeyAlreadyCoveredError(context.virtualKeyId);
      }
      if (isCheckViolation(error)) {
        throw new CoverageStartNotAfterCurrentError({
          virtualKeyId: context.virtualKeyId,
          currentStartedAt: context.effectiveFrom,
        });
      }
      throw error;
    }
  }
}
