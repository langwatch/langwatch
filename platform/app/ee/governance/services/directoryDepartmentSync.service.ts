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
 * Who a row may assign is decided by the match engine's own proof standard,
 * through the same account index (`loadAccountIndex`): the directory id the
 * org's SSO connection recorded, or an address a member has CONFIRMED. An
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
  normalizeEmail,
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

    const memberships = await this.prisma.organizationUser.findMany({
      where: { organizationId, userId: { in: [...desired.keys()] } },
      select: { userId: true, departmentId: true },
    });
    const currentByUser = new Map(
      memberships.map((m) => [m.userId, m.departmentId]),
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

      if (currentByUser.get(userId) === departmentId) continue;
      await this.departments.assignUser({
        organizationId,
        userId,
        departmentId,
      });
      assigned += 1;
    }

    if (assigned > 0) {
      logger.info(
        { organizationId, assigned },
        "directory departments assigned to proven members",
      );
    }
    return { assigned };
  }
}

/**
 * The one member a directory row proves, or null.
 *
 * The directory id is checked first — it is the identifier the row IS keyed
 * by — and the confirmed address second. Either way, exactly one candidate
 * or nobody: the engine suspends automatic linking on a contradiction, and
 * an assignment must not out-run the engine's own caution.
 */
function provenUserId({
  row,
  accounts,
}: {
  row: NormalizedPullEvent;
  accounts: OrganizationAccountIndex;
}): string | null {
  const byDirectory = accounts.usersByDirectoryId.get(row.actor) ?? [];
  if (byDirectory.length === 1) return byDirectory[0] ?? null;
  if (byDirectory.length > 1) return null;

  const mailKey = normalizeEmail(extraString(row, "mail"));
  if (mailKey === null) return null;
  const byMail = accounts.usersByVerifiedEmail.get(mailKey) ?? [];
  return byMail.length === 1 ? (byMail[0] ?? null) : null;
}
