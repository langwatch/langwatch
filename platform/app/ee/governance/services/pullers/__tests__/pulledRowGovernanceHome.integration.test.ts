// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Where a pulled provider cost row lives, and who its money belongs to.
 *
 * ADR-128 gives every pulled row an explicit organization-level home so
 * nothing arrives homeless: the org's hidden governance project, the same
 * partition the OCSF audit rows and the ledger's TenantId already use. The
 * home says where the row is STORED. Who the money BELONGS TO is a different
 * field, and the two must never collapse into one another.
 *
 * Real Postgres and the real helper, not a stubbed project id: the home is
 * only worth asserting if it is the row the org actually has.
 *
 * Spec: specs/governance/pulled-rows-home-and-leak-gate.feature
 * Decision: ADR-128.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Organization, Team } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { pulledUsageScopeId } from "../../../process-manager/pulledUsageLedger.process";
import {
  ensureHiddenGovernanceProject,
  PROJECT_KIND,
} from "../../governanceProject.service";
import { buildPulledUsageRecord } from "../pulledUsageRecord";
import type { NormalizedPullEvent } from "../pullerAdapter";

const ns = `pulled-home-${nanoid(8)}`;

let organization: Organization;
let team: Team;
/** A second tenant, to prove one org's home is never the other's. */
let otherOrganization: Organization;
let otherTeam: Team;

const OBSERVED_AT = new Date("2026-08-06T09:00:00.000Z");

function usageEvent(): NormalizedPullEvent {
  return {
    source_event_id: `usage:2026-08-01:${ns}`,
    event_timestamp: "2026-08-01T00:00:00.000Z",
    actor: "",
    action: "usage_report",
    target: "anthropic/claude-sonnet-5",
    cost_usd: "0",
    tokens_input: 120_000,
    tokens_output: 8_000,
    raw_payload: "{}",
    extra: {
      pulled_usage: {
        costBasis: "computed",
        dimensions: { granularity: "1d", workspaceId: "ws_1" },
        model: "anthropic/claude-sonnet-5",
      },
    },
  };
}

async function governanceHomesFor(organizationId: string) {
  return prisma.project.findMany({
    where: {
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      team: { organizationId },
      archivedAt: null,
    },
  });
}

beforeAll(async () => {
  organization = await prisma.organization.create({
    data: { name: `Home ${ns}`, slug: `--test-org-${ns}` },
  });
  team = await prisma.team.create({
    data: {
      name: `Home ${ns}`,
      slug: `--test-team-${ns}`,
      organizationId: organization.id,
    },
  });

  otherOrganization = await prisma.organization.create({
    data: { name: `Home other ${ns}`, slug: `--test-org-other-${ns}` },
  });
  otherTeam = await prisma.team.create({
    data: {
      name: `Home other ${ns}`,
      slug: `--test-team-other-${ns}`,
      organizationId: otherOrganization.id,
    },
  });
});

afterAll(async () => {
  for (const org of [organization, otherOrganization].filter(Boolean)) {
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

describe("a pulled usage record arriving from a provider source", () => {
  describe("given an organization with a connected provider source", () => {
    /** @scenario "A pulled row gets the organization's governance home on arrival" */
    it("stores the row under the governance home and attributes the money to the source's team", async () => {
      const home = await ensureHiddenGovernanceProject(prisma, organization.id);

      const record = buildPulledUsageRecord({
        event: usageEvent(),
        source: {
          ingestionSourceId: `src_${ns}`,
          sourceType: "anthropic_admin",
          organizationId: organization.id,
          teamId: team.id,
        },
        governanceProjectId: home.id,
        observedAt: OBSERVED_AT,
      });

      expect(record).not.toBeNull();
      // The storage home is the org's real governance project, not a value
      // invented at the seam.
      expect(record?.projectId).toBe(home.id);
      expect(home.kind).toBe(PROJECT_KIND.INTERNAL_GOVERNANCE);

      // And the money's owner is the source's team — the field the ledger's
      // Scope is derived from, which the home never becomes.
      expect(record?.organizationId).toBe(organization.id);
      expect(record?.teamId).toBe(team.id);
      expect(pulledUsageScopeId(record!)).toBe(team.id);
      expect(pulledUsageScopeId(record!)).not.toBe(home.id);
    });

    /** @scenario "The organization has exactly one governance home, created when absent" */
    it("mints one home per organization, and pulling again mints no second", async () => {
      // The second organization gets its home first, so the assertion below
      // is about tenancy and not about ordering.
      const otherHome = await ensureHiddenGovernanceProject(
        prisma,
        otherOrganization.id,
      );
      expect(otherHome.teamId).toBe(otherTeam.id);

      const first = await ensureHiddenGovernanceProject(
        prisma,
        organization.id,
      );
      const second = await ensureHiddenGovernanceProject(
        prisma,
        organization.id,
      );

      expect(second.id).toBe(first.id);
      expect(await governanceHomesFor(organization.id)).toHaveLength(1);

      // The other tenant's home is neither shared nor disturbed by the
      // repeated ensure above.
      const otherHomes = await governanceHomesFor(otherOrganization.id);
      expect(otherHomes).toHaveLength(1);
      expect(otherHomes[0]!.id).toBe(otherHome.id);
      expect(otherHomes[0]!.id).not.toBe(first.id);
    });
  });
});
