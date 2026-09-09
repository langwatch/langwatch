// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The directory's department field, landed on the entities we already have.
 *
 * SCIM provisioning has mapped directory-asserted department text onto
 * `Department` rows for a while (costCenter → `resolveByNameOrCreate` +
 * `assignUser`, `scim.service.ts`). This service is the same mapping for
 * organizations whose directory we READ rather than are pushed by: a pulled
 * directory row carries the tenant's own department string, and it lands
 * through the identical two calls — no parallel department shape, no free
 * text on the person row.
 *
 * Assignment uses the match engine's conflict rule and account index
 * (`loadAccountIndex`): the directory id the org's SSO connection recorded,
 * or an address a member has CONFIRMED. Directory-only assignment remains
 * supported here; opening an identity link has a stricter evidence rule. An
 * unconfirmed address is a claim anyone can type in, and two candidates are
 * a contradiction, not a coin toss — both assign nobody.
 *
 * Two deliberate divergences from the SCIM push:
 *
 *  - a BLANK department leaves the member's assignment alone, where SCIM
 *    clears it. A pull is an observation, not a provisioning command; Entra
 *    tenants routinely leave the field blank, and blank must not erase an
 *    admin's hand-work once a day;
 *  - rows proving no member do nothing here at all. They still become
 *    discovered people (personDiscovery.service.ts), and the day one is
 *    linked, the next directory read assigns their department unasked.
 *
 * Fed with KEPT events only, like every consumer downstream of the erasure
 * partition — a directory row naming an erased identifier never reaches
 * here.
 *
 * Spec: specs/governance/governance-people-discovery.feature
 */

import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";

import { DepartmentService } from "./department/department.service";
import { IdentityMatchService } from "./identityMatch.service";
import {
  decideMatch,
  type OrganizationAccountIndex,
} from "./logic/identityEvidence";
import { DIRECTORY_REPORT_ACTION } from "./pullers/microsoftGraphDirectory";
import type { NormalizedPullEvent } from "./pullers/pullerAdapter";

const logger = createLogger("langwatch:governance:directory-departments");

/** A string field off an event's `extra`, or "" for anything else. */
function extraString(event: NormalizedPullEvent, field: string): string {
  const value = event.extra?.[field];
  return typeof value === "string" ? value : "";
}

export class DirectoryDepartmentSyncService {
  private readonly prisma: PrismaClient;
  private readonly departments: DepartmentService;
  private readonly matcher: IdentityMatchService;

  constructor({ prisma }: { prisma: PrismaClient }) {
    this.prisma = prisma;
    this.departments = DepartmentService.create(prisma);
    this.matcher = IdentityMatchService.create(prisma);
  }

  static create(prisma: PrismaClient): DirectoryDepartmentSyncService {
    return new DirectoryDepartmentSyncService({ prisma });
  }

  /**
   * Applies whatever department facts a batch of directory events carries.
   *
   * One account-index load per batch, one department resolve per distinct
   * name, and no write at all for a member already where the directory says
   * they belong — the read runs daily, and an idempotent day must cost
   * nothing.
   */
  async applyDirectoryEvents({
    organizationId,
    events,
  }: {
    organizationId: string;
    events: NormalizedPullEvent[];
  }): Promise<{ assigned: number }> {
    const rows = events.filter(
      (event) =>
        event.action === DIRECTORY_REPORT_ACTION &&
        extraString(event, "department").trim() !== "",
    );
    if (rows.length === 0) return { assigned: 0 };

    const accounts = await this.matcher.loadAccountIndex({ organizationId });

    // userId → department name, resolved through the proof rule. Built first
    // so the current-assignment read below is one query for the whole batch.
    const desired = new Map<string, string>();
    for (const row of rows) {
      const department = extraString(row, "department").trim();
      const userId = provenUserId({ row, accounts });
      if (userId !== null) desired.set(userId, department);
    }
    if (desired.size === 0) return { assigned: 0 };

    const assigned = await this.assignWhereChanged({ organizationId, desired });

    if (assigned > 0) {
      logger.info(
        { organizationId, assigned },
        "directory departments assigned to proven members",
      );
    }
    return { assigned };
  }

  /** Writes each changed assignment, resolving each department name once. */
  private async assignWhereChanged({
    organizationId,
    desired,
  }: {
    organizationId: string;
    desired: Map<string, string>;
  }): Promise<number> {
    const memberships = await this.prisma.organizationUser.findMany({
      where: { organizationId, userId: { in: [...desired.keys()] } },
      select: { userId: true, departmentId: true },
    });
    const currentByUser = new Map(
      memberships.map((m) => [m.userId, m.departmentId]),
    );
    // The dated links beside the pointer (ADR-128 §13, #7882). Read so the
    // no-op check below can require BOTH to match: a member assigned before
    // links existed has the right pointer and no open link, and skipping them
    // would leave "who was here in January" answering "unassigned" until
    // their first real reorg. One indexed query; on the steady-state day it
    // still leads to zero writes.
    const openLinks = await this.prisma.departmentMembershipHistory.findMany({
      where: {
        organizationId,
        userId: { in: [...desired.keys()] },
        validTo: null,
      },
      select: { userId: true, departmentId: true },
    });
    const openLinkByUser = new Map(
      openLinks.map((link) => [link.userId, link.departmentId]),
    );

    const departmentByName = new Map<string, string>();
    let assigned = 0;
    for (const [userId, name] of desired) {
      // Proof can point at a user who is not a member of THIS organization
      // (a verified address is global). No membership row, nothing to assign.
      if (!currentByUser.has(userId)) continue;

      let departmentId = departmentByName.get(name);
      if (departmentId === undefined) {
        departmentId = (
          await this.departments.resolveByNameOrCreate({ organizationId, name })
        ).id;
        departmentByName.set(name, departmentId);
      }

      if (
        currentByUser.get(userId) === departmentId &&
        openLinkByUser.get(userId) === departmentId
      ) {
        continue;
      }
      await this.departments.assignUser({
        organizationId,
        userId,
        departmentId,
      });
      assigned += 1;
    }
    return assigned;
  }
}

/**
 * The one member a directory row proves, or null.
 *
 * Conflicting proof is rejected before choosing either identifier. Otherwise
 * keep directory-only assignment: the match engine's no-action result means
 * "do not open an identity link", not "discard the directory's department".
 */
function provenUserId({
  row,
  accounts,
}: {
  row: NormalizedPullEvent;
  accounts: OrganizationAccountIndex;
}): string | null {
  const decision = decideMatch({
    identity: { rawActorId: row.actor, displayText: extraString(row, "mail") },
    accounts,
  });
  if (decision.outcome === "suspend") return null;

  const byDirectory = accounts.usersByDirectoryId.get(row.actor) ?? [];
  if (byDirectory.length === 1) return byDirectory[0] ?? null;
  if (byDirectory.length > 1) return null;

  return decision.outcome === "link" ? decision.userId : null;
}
