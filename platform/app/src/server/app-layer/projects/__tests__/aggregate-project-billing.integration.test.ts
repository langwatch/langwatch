/**
 * @vitest-environment node
 *
 * ADR-144 decision 7: data is stored once. A member's traces are billed to the
 * member, and the aggregate that reads them counts nothing, because nothing
 * is ever written under its tenant. Real ClickHouse, the real trace-usage
 * count, and an organisation whose project list includes the aggregate.
 *
 * This pins today's behaviour: no block D code is under test here, since the
 * usage count was already per project and nothing writes under the aggregate.
 *
 * @see specs/governance/aggregate-project.feature
 */

import { BillableEventsClickHouseRepository } from "@ee/billing/services/billableEvents.clickhouse.repository";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { TraceUsageService } from "~/server/traces/trace-usage.service";
import {
  type AggregateFixture,
  realOrganizationService,
  seedAggregateOrganization,
} from "./aggregateProjectFixture";

const MEMBER_TRACES = 3;

describe("Feature: billing stays with the owning project", () => {
  let fixture: AggregateFixture;

  const countFor = async (projectIds: string[]) => {
    const counts = await TraceUsageService.create(prisma).getCountByProjects({
      organizationId: fixture.organizationId,
      projectIds,
    });
    if (!Array.isArray(counts)) throw new Error("usage came back unknown");
    return new Map(counts.map(({ projectId, count }) => [projectId, count]));
  };

  beforeAll(async () => {
    const clickhouse = getTestClickHouseClient();
    if (!clickhouse) throw new Error("the ClickHouse test client is not up");
    globalForApp.__langwatch_app = createTestApp({
      organizations: realOrganizationService(prisma),
      billableEvents: new BillableEventsClickHouseRepository(
        async () => clickhouse,
        async () => clickhouse,
      ),
    });
    fixture = await seedAggregateOrganization(prisma, { label: "agg-billing" });

    const now = Date.now();
    await clickhouse.insert({
      table: "trace_summaries",
      values: Array.from({ length: MEMBER_TRACES }, () => ({
        TenantId: fixture.personal.engineer.id,
        TraceId: `agg-billing-${nanoid(12)}`,
        CreatedAt: now,
        UpdatedAt: now,
      })),
      format: "JSONEachRow",
    });
  });

  afterAll(async () => {
    await resetApp();
    await fixture?.cleanup();
  });

  /** @scenario "Billing stays with the owning project" */
  describe("given an aggregate project with a member holding traces", () => {
    describe("when usage is counted", () => {
      it("leaves the member's count unchanged and counts zero for the aggregate", async () => {
        const member = fixture.personal.engineer.id;
        const before = await countFor([member]);
        expect(before.get(member)).toBe(MEMBER_TRACES);

        const aggregate = await fixture.makeAggregate("company-view");
        const after = await countFor([member, aggregate.id]);

        expect(after.get(member)).toBe(before.get(member));
        expect(after.get(aggregate.id)).toBe(0);
      });
    });
  });
});
