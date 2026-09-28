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
 * (`loadAccountIndex`): the accepted identity link when the person already
 * holds one, otherwise the directory id the org's SSO connection recorded, or
 * an address a member has CONFIRMED. Directory-only assignment remains
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

import {
  DiscoveredPersonRepository,
  IdentityMatchRepository,
} from "../repositories/governanceIdentity.repository";
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

export interface DirectoryDepartmentSyncDeps {
  prisma: PrismaClient;
  departments?: DepartmentService;
  matcher?: IdentityMatchService;
  discoveredPeople?: DiscoveredPersonRepository;
  matches?: IdentityMatchRepository;
}

export class DirectoryDepartmentSyncService {
  private readonly prisma: PrismaClient;
  private readonly departments: DepartmentService;
  private readonly matcher: IdentityMatchService;
  private readonly discoveredPeople: DiscoveredPersonRepository;
  private readonly matches: IdentityMatchRepository;

  constructor(deps: DirectoryDepartmentSyncDeps) {
    this.prisma = deps.prisma;
    this.departments =
      deps.departments ?? DepartmentService.create(deps.prisma);
    this.matcher = deps.matcher ?? IdentityMatchService.create(deps.prisma);
    this.discoveredPeople =
      deps.discoveredPeople ?? new DiscoveredPersonRepository();
    this.matches = deps.matches ?? new IdentityMatchRepository();
  }

  static create(prisma: PrismaClient): DirectoryDepartmentSyncService {
    return new DirectoryDepartmentSyncService({ prisma });
  }

  /**
   * Applies whatever department facts a batch of directory events carries.
   *
   * One account-index load per batch, one open-link load per batch, one
   * department resolve per distinct name, and no write at all for a member
   * already where the directory says they belong — the read runs daily, and an
   * idempotent day must cost nothing.
   *
   * `provider` is the source type the same pull recorded its discovered people
   * under (`personDiscovery.service.ts`), and it is what makes the open-link
   * read exact: `rawActorId` only identifies somebody relative to the provider
   * that issued it.
   */
  async applyDirectoryEvents({
    organizationId,
    provider,
    events,
  }: {
    organizationId: string;
    provider: string;
    events: NormalizedPullEvent[];
  }): Promise<{ assigned: number }> {
    const rows = events.filter(
      (event) =>
        event.action === DIRECTORY_REPORT_ACTION &&
        extraString(event, "department").trim() !== "",
    );
    if (rows.length === 0) return { assigned: 0 };

    const [accounts, openLinkByActor] = await Promise.all([
      this.matcher.loadAccountIndex({ organizationId }),
      this.loadOpenLinkByActor({
        organizationId,
        provider,
        rawActorIds: [...new Set(rows.map((row) => row.actor))],
      }),
    ]);

    // userId → department name, resolved through the proof rule. Built first
    // so the current-assignment read below is one query for the whole batch.
    const desired = new Map<string, string>();
    for (const row of rows) {
      const department = extraString(row, "department").trim();
      const userId = provenUserId({
        row,
        accounts,
        openLinkUserId: openLinkByActor.get(row.actor) ?? null,
      });
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

  /**
   * The account each of this batch's directory identifiers is already linked
   * to, by the provider's own identifier.
   *
   * The accepted link is evidence in its own right — a human confirmed it, or
   * an earlier pass proved it — and without it here a directory row that
   * disagrees is free to re-file somebody's department under a different
   * account. Two reads rather than a join: `IdentityMatch` carries the person
   * id and `DiscoveredPerson` the provider identifier, and each table belongs
   * to its own repository. Links an erasure blanked are excluded by
   * `findOpenByOrganization`, which is what we want — a link to nobody has
   * nothing to contradict.
   */
  private async loadOpenLinkByActor({
    organizationId,
    provider,
    rawActorIds,
  }: {
    organizationId: string;
    provider: string;
    rawActorIds: string[];
  }): Promise<Map<string, string>> {
    const people = await this.discoveredPeople.findByActorIds(this.prisma, {
      organizationId,
      provider,
      rawActorIds,
    });
    if (people.length === 0) return new Map();

    const openLinks = await this.matches.findOpenByOrganization(this.prisma, {
      organizationId,
    });
    const userByPersonId = new Map(
      openLinks.map((link) => [link.discoveredPersonId, link.userId]),
    );

    const byActor = new Map<string, string>();
    for (const person of people) {
      const userId = userByPersonId.get(person.id);
      if (typeof userId === "string") byActor.set(person.rawActorId, userId);
    }
    return byActor;
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
 *
 * An accepted link outranks the directory index. It is somebody's dated,
 * reviewable answer to "who is this?" — human-confirmed, or proved by an
 * address the account holder confirmed — and `decideMatch` has just been
 * handed the chance to contradict it. A stale `ScimExternalId` naming a
 * different member must not quietly move a department off the account an
 * admin accepted; the directory identifier corroborates, it never stands
 * alone (ADR-128 §12).
 */
function provenUserId({
  row,
  accounts,
  openLinkUserId,
}: {
  row: NormalizedPullEvent;
  accounts: OrganizationAccountIndex;
  openLinkUserId: string | null;
}): string | null {
  const decision = decideMatch({
    identity: {
      rawActorId: row.actor,
      displayText: extraString(row, "mail"),
      openLinkUserId,
    },
    accounts,
  });
  if (decision.outcome === "suspend") return null;

  if (openLinkUserId !== null) return openLinkUserId;

  const byDirectory = accounts.usersByDirectoryId.get(row.actor) ?? [];
  if (byDirectory.length === 1) return byDirectory[0] ?? null;
  if (byDirectory.length > 1) return null;

  return decision.outcome === "link" ? decision.userId : null;
}
