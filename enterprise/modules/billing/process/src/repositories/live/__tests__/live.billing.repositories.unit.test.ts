// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ClickHouseQueryClient,
  routingDriver,
  type ClickHouseConnection,
  type RoutableStatementClient,
} from "@langwatch/clickhouse-client";
import { BILLING_REPORT_COMMAND_TYPES } from "@langwatch/enterprise-billing-contract";
import { createTenantId } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { ReportUsageForMonthCommandHandler } from "../../../eventing/report-usage-for-month.commands.ts";
import { BillingErrorReporterService } from "../../../services/billing-error-reporter.service.ts";
import type { UsageReportingService } from "../../../services/usage-reporting.service.ts";
import { LiveBillingRepositories } from "../live.billing.repositories.ts";

const WINDOW = {
  startDate: "2026-09-01 00:00:00.000",
  endDate: "2026-10-01 00:00:00.000",
};

describe("LiveBillingRepositories", () => {
  describe("given a worker composing the month's total over its own tenant-keyed ClickHouse client", () => {
    /** @scenario "The worker reads the month's total by organization, not by tenant" */
    it("resolves the client for the organization and never for a project", async () => {
      const resolved: string[] = [];
      const vendor = createApiFixture<RoutableStatementClient>({
        query: async () => ({
          json: async () => [{ total: "7", projectId: "project_1" }],
          stream: async function* () {},
        }),
      });
      const connection = createApiFixture<ClickHouseConnection<RoutableStatementClient>>({
        resolveOrganization: (organizationId) => {
          resolved.push(organizationId);
          return vendor;
        },
      });
      const { billableEvents } = LiveBillingRepositories.create({
        prisma: prismaDouble(),
        clickhouse: new ClickHouseQueryClient({ driver: routingDriver(connection) }),
        redis: memoryRedisDouble(),
      });

      await expect(billableEvents.findTotal({ organizationId: "org_1", ...WINDOW })).resolves.toBe(
        7,
      );
      await expect(
        billableEvents.findByProject({ organizationId: "org_1", ...WINDOW }),
      ).resolves.toEqual([{ projectId: "project_1", count: 7 }]);

      expect(resolved).toEqual(["org_1", "org_1"]);
    });
  });

  describe("given a worker holding one Prisma client and the queue's one Redis", () => {
    /** @scenario "The worker builds the monthly roll-up from its own client" */
    it("reads the organization and the checkpoint through that client and caches through that Redis", async () => {
      const organizationReads: unknown[] = [];
      const checkpointReads: unknown[] = [];
      const checkpointWrites: unknown[] = [];
      const prisma = prismaDouble({
        organization: {
          findFirst: async (args) => {
            organizationReads.push(args?.where);
            return {
              id: "org_1",
              pricingModel: "SEAT_EVENT",
              stripeCustomerId: "cus_1",
              selfHostedCustomer: false,
              subscriptions: [{ id: "sub_1" }],
            };
          },
        },
        billingMeterCheckpoint: {
          findUnique: async (args) => {
            checkpointReads.push(args.where);
            return null;
          },
          upsert: async (args) => {
            checkpointWrites.push(args.where);
            return {};
          },
        },
      });
      const store = memoryRedisStore();
      const cacheLifetimes: unknown[] = [];
      const repositories = LiveBillingRepositories.create({
        prisma,
        clickhouse: clickHouseQueryClientDouble(),
        redis: memoryRedisDouble({
          store,
          script: {
            setex: async (key, seconds, value) => {
              cacheLifetimes.push(seconds);
              store.strings.set(String(key), String(value));
              return "OK";
            },
          },
        }),
      });
      const handler = ReportUsageForMonthCommandHandler.create({
        organizations: repositories.reportOrganizations,
        billingCheckpoints: repositories.checkpoints,
        organizationCache: repositories.organizationCache,
        getUsageReportingService: () =>
          createApiFixture<UsageReportingService>({
            reportUsageDelta: async () => [{ identifier: "sent", reported: true, valueSent: 5 }],
          }),
        queryInstantEvalSpendTotal: async () => ({ outcome: "unavailable" }),
        selfDispatch: async () => {},
        errorReporter: BillingErrorReporterService.create(),
        connectedUsageCeiling: async () => null,
      });
      const command = {
        tenantId: createTenantId("org_1"),
        aggregateId: "org_1",
        type: BILLING_REPORT_COMMAND_TYPES.REPORT_USAGE_FOR_MONTH,
        data: {
          organizationId: "org_1",
          billingMonth: "2026-09",
          tenantId: "org_1",
          occurredAt: 1_000,
          billableEvents: 5,
          countedEventId: "evt_1",
        },
      };

      await handler.handle(command);
      await handler.handle(command);

      const checkpointKey = {
        organizationId_billingMonth_meter: {
          organizationId: "org_1",
          billingMonth: "2026-09",
          meter: "langwatch_billable_events",
        },
      };
      expect(organizationReads).toEqual([{ id: "org_1" }]);
      expect(checkpointReads).toContainEqual(checkpointKey);
      expect(checkpointWrites).toContainEqual(checkpointKey);
      expect([...store.strings.keys()]).toEqual(["ttlcache:billing:orgData:org_1"]);
      expect(cacheLifetimes).toEqual([60]);
    });
  });
});
