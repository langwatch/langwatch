// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The run-status projection mirrors four columns back onto `IngestionSource`,
 * and that write used to be keyed on the source id alone. The projection's
 * tenant is the org's hidden governance project, so a projection carrying a
 * source id from another org wrote straight into that org's row: its cursor,
 * its error count, its status. Real Postgres, two real orgs, because a
 * tenancy claim asserted against a mock is a claim about the mock.
 *
 * Decision: ADR-128.
 */

import type { IngestionPullRunStatusData } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/projections/ingestionPullRunStatus.foldProjection";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Organization, Team } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { StoredProjection } from "~/server/event-sourcing/projections/stateProjection.types";
import { ensureHiddenGovernanceProject } from "../../../governanceProject.service";
import { PrismaIngestionPullRunProjectionRepository } from "../ingestion-pull-run-projection.prisma.repository";

const ns = `pull-tenancy-${nanoid(8)}`;

let organization: Organization;
let team: Team;
let otherOrganization: Organization;
let otherTeam: Team;
/** Lives in `otherOrganization`, and must stay untouched throughout. */
let foreignSourceId: string;
/** The tenant every store() below writes under: this org's governance home. */
let homeProjectId: string;

function projectionFor(
  sourceId: string,
): StoredProjection<IngestionPullRunStatusData> {
  return {
    state: {
      SourceId: sourceId,
      Enabled: true,
      Cron: "*/5 * * * *",
      Cursor: "cursor-from-the-wrong-tenant",
      LastRunAt: 2_000,
      LastRunOutcome: "completed",
      LastRunEventCount: 7,
      LastRunError: null,
      LastRunErrorCode: null,
      ConsecutiveErrors: 4,
      LastSuccessAt: 2_000,
      LastRunScheduledFor: 1_500,
      CreatedAt: 1_000,
      UpdatedAt: 2_000,
      LastEventOccurredAt: 2_000,
    },
    cursor: { acceptedAt: 2_001, eventId: `event-${ns}` },
    occurredAt: 2_000,
    createdAt: 1_000,
    updatedAt: 2_000,
    version: "2026-08-28",
  };
}

beforeAll(async () => {
  organization = await prisma.organization.create({
    data: { name: `Tenancy ${ns}`, slug: `--test-org-${ns}` },
  });
  team = await prisma.team.create({
    data: {
      name: `Tenancy ${ns}`,
      slug: `--test-team-${ns}`,
      organizationId: organization.id,
    },
  });
  otherOrganization = await prisma.organization.create({
    data: { name: `Tenancy other ${ns}`, slug: `--test-org-other-${ns}` },
  });
  otherTeam = await prisma.team.create({
    data: {
      name: `Tenancy other ${ns}`,
      slug: `--test-team-other-${ns}`,
      organizationId: otherOrganization.id,
    },
  });

  const foreignSource = await prisma.ingestionSource.create({
    data: {
      organizationId: otherOrganization.id,
      teamId: otherTeam.id,
      sourceType: "anthropic_admin",
      name: `Foreign ${ns}`,
      ingestSecretHash: `hash-${ns}`,
      pollerCursor: "cursor-owned-by-the-other-org",
      errorCount: 0,
      status: "awaiting_first_event",
    },
  });
  foreignSourceId = foreignSource.id;
  homeProjectId = (await ensureHiddenGovernanceProject(prisma, organization.id))
    .id;
});

afterAll(async () => {
  await prisma.ingestionPullRunProjection
    .deleteMany({ where: { projectId: homeProjectId } })
    .catch(() => undefined);
  for (const org of [organization, otherOrganization].filter(Boolean)) {
    await prisma.ingestionSource
      .deleteMany({ where: { organizationId: org.id } })
      .catch(() => undefined);
    await prisma.project
      .deleteMany({ where: { team: { organizationId: org.id } } })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({ where: { organizationId: org.id } })
      .catch(() => undefined);
    await prisma.organization
      .delete({ where: { id: org.id } })
      .catch(() => undefined);
  }
});

describe("given a run-status projection whose source belongs to another organization", () => {
  describe("when it is stored under this organization's governance tenant", () => {
    it("leaves the other organization's source completely untouched", async () => {
      const repository = new PrismaIngestionPullRunProjectionRepository(prisma);

      await repository.store(projectionFor(foreignSourceId), {
        aggregateId: foreignSourceId,
        tenantId: createTenantId(homeProjectId),
      });

      const foreign = await prisma.ingestionSource.findUniqueOrThrow({
        where: { id: foreignSourceId },
      });
      expect(foreign.pollerCursor).toBe("cursor-owned-by-the-other-org");
      expect(foreign.errorCount).toBe(0);
      expect(foreign.status).toBe("awaiting_first_event");
      expect(foreign.lastSuccessAt).toBeNull();
    });
  });
});

describe("given a run-status projection whose source belongs to this organization", () => {
  describe("when it is stored under the organization's governance tenant", () => {
    it("mirrors the run outcome onto the source", async () => {
      const source = await prisma.ingestionSource.create({
        data: {
          organizationId: organization.id,
          teamId: team.id,
          sourceType: "anthropic_admin",
          name: `Own ${ns}`,
          ingestSecretHash: `hash-own-${ns}`,
          errorCount: 0,
          status: "awaiting_first_event",
        },
      });
      const repository = new PrismaIngestionPullRunProjectionRepository(prisma);

      await repository.store(projectionFor(source.id), {
        aggregateId: source.id,
        tenantId: createTenantId(homeProjectId),
      });

      const mirrored = await prisma.ingestionSource.findUniqueOrThrow({
        where: { id: source.id },
      });
      expect(mirrored.pollerCursor).toBe("cursor-from-the-wrong-tenant");
      expect(mirrored.errorCount).toBe(4);
      expect(mirrored.lastSuccessAt).toEqual(new Date(2_000));
    });
  });
});
