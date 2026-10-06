import type { ReportUsageForMonthCommandData } from "@langwatch/enterprise-billing-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { USAGE_MONTH_COUNTED_EVENT_TYPE } from "@langwatch/usage-contract";
import { describe, expect, it } from "vitest";

import { BillingModule, type ConnectedBillingPeers } from "../../app/billing.app.ts";
import { billingProcessModule } from "../../billing.module.ts";
import { MemoryBillingRepositories } from "../../repositories/memory/memory.billing.repositories.ts";
import { BillingErrorReporterService } from "../../services/billing-error-reporter.service.ts";
import type { ResourceLimitAlertService } from "../../services/resource-limit-alert.service.ts";
import { StripeUsageReportingUnavailable } from "../../services/usage-reporting.service.ts";
import type { UsageWarningService } from "../../services/usage-warning.service.ts";
import {
  BILLING_MONTH_COUNTED_SUBSCRIBER_NAME,
  BillingReportingPipeline,
  billingReportingEventing,
} from "../billing-reporting.pipeline.ts";

const peers: ConnectedBillingPeers = {
  licensing: createApiFixture<ConnectedBillingPeers["licensing"]>({}),
  authorization: { can: async () => false },
  auditLog: createApiFixture<ConnectedBillingPeers["auditLog"]>({}),
  organizations: createApiFixture<ConnectedBillingPeers["organizations"]>({}),
  gateway: createApiFixture<ConnectedBillingPeers["gateway"]>({}),
};

const MONTH_COUNTED_LANE = `billing_reporting.${BILLING_MONTH_COUNTED_SUBSCRIBER_NAME}`;

/** The roll-up composed as the app composes it. */
function rollUp() {
  const repositories = MemoryBillingRepositories.create();
  return BillingReportingPipeline.create({
    organizations: repositories.reportOrganizations,
    billingCheckpoints: repositories.checkpoints,
    getUsageReportingService: () => void 0,
    queryInstantEvalSpendTotal: async () => ({ outcome: "unavailable" }),
    organizationCache: repositories.organizationCache,
    errorReporter: BillingErrorReporterService.create(),
    connectedUsageCeiling: async () => null,
  });
}

/** The roll-up's peer subscribers, as the runtime's global registry would receive them. */
function peerSubscribers(pipeline: BillingReportingPipeline) {
  const definition = pipeline.buildProcessing({ participation: "produce" });
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof definition.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void subscribers.push(subscriber),
  });
  for (const projection of definition.globalProjections ?? []) projection.register(registry);
  return { definition, subscribers };
}

function monthCounted(billableEvents: number): Event {
  return {
    id: "evt_1",
    aggregateId: "org_1",
    aggregateType: "usage",
    tenantId: createTenantId("org_1"),
    createdAt: 0,
    occurredAt: 1_000,
    type: USAGE_MONTH_COUNTED_EVENT_TYPE,
    version: "2026-01-01",
    data: {
      organizationId: "org_1",
      month: "2026-09",
      occurredAt: 1_000,
      billableEvents,
      limit: { allowance: 10_000, planName: "Launch", unit: "events" },
    },
  };
}

describe("the monthly billing roll-up's eventing declaration", () => {
  describe("given a deployment that is not SaaS", () => {
    /** @scenario "The monthly roll-up is registered on every install" */
    it("still mounts the roll-up, with no meter beside it", () => {
      const app = BillingModule.assemble({
        usageWarnings: createApiFixture<UsageWarningService>({}),
        resourceLimitAlerts: createApiFixture<ResourceLimitAlertService>({}),
        repositories: MemoryBillingRepositories.create(),
        config: {
          bankDetails: undefined,
          licensePaymentLinkId: undefined,
          isSaas: false,
          nodeEnvironment: "test",
        },
        peers,
        stripeSecretKey: undefined,
      });

      const pipeline = app.reportingPipeline({ participation: "consume" });

      expect(billingProcessModule.eventing?.pipeline.split(", ")).toContain("billing_reporting");
      expect(billingReportingEventing.pipeline).toBe("billing_reporting");
      expect(pipeline.metadata.name).toBe("billing_reporting");
      expect(pipeline.foldProjections.size + pipeline.mapProjections.size).toBe(0);
      expect(pipeline.globalProjections?.map(({ name }) => name)).toEqual([MONTH_COUNTED_LANE]);
    });
  });

  describe("given a SaaS deployment with no Stripe secret", () => {
    const composeSaas = () =>
      BillingModule.assemble({
        usageWarnings: createApiFixture<UsageWarningService>({}),
        resourceLimitAlerts: createApiFixture<ResourceLimitAlertService>({}),
        repositories: MemoryBillingRepositories.create(),
        config: {
          bankDetails: undefined,
          licensePaymentLinkId: undefined,
          isSaas: true,
          nodeEnvironment: "test",
        },
        peers,
        stripeSecretKey: undefined,
      });

    /** @scenario "A SaaS worker refuses to compose without the credential its reports are sent with" */
    it("refuses the worker's build and lets the api's producer build", () => {
      expect(() => composeSaas().reportingPipeline({ participation: "consume" })).toThrow(
        StripeUsageReportingUnavailable,
      );
      expect(composeSaas().reportingPipeline({ participation: "produce" }).metadata.name).toBe(
        "billing_reporting",
      );
    });
  });

  describe("given usage owns the billable-events meter", () => {
    /** @scenario "The billable-events meter keeps its lane name" */
    it("registers no projection under the meter's lane name", () => {
      const pipeline = BillingModule.assemble({
        usageWarnings: createApiFixture<UsageWarningService>({}),
        resourceLimitAlerts: createApiFixture<ResourceLimitAlertService>({}),
        repositories: MemoryBillingRepositories.create(),
        config: {
          bankDetails: undefined,
          licensePaymentLinkId: undefined,
          isSaas: true,
          nodeEnvironment: "test",
        },
        peers,
        stripeSecretKey: undefined,
      }).reportingPipeline({ participation: "produce" });

      expect(pipeline.globalProjections?.map(({ name }) => name)).not.toContain(
        "orgBillableEventsMeter",
      );
    });
  });

  describe("given usage records a month's counted total", () => {
    /** @scenario "Billing reports to Stripe from the month's counted total" */
    it("subscribes to month_counted and dispatches the month's report with that total", async () => {
      const pipeline = rollUp();
      const { definition, subscribers } = peerSubscribers(pipeline);
      const [subscriber] = subscribers;
      const reported: ReportUsageForMonthCommandData[] = [];
      pipeline.connectSelfDispatch(async (data) => void reported.push(data));

      await subscriber?.handle(monthCounted(5_000), {
        tenantId: "org_1",
        aggregateId: "org_1",
      });

      expect(definition.globalProjections?.map(({ name }) => name)).toEqual([MONTH_COUNTED_LANE]);
      expect(subscriber?.eventTypes).toEqual([USAGE_MONTH_COUNTED_EVENT_TYPE]);
      expect(reported).toEqual([
        {
          organizationId: "org_1",
          billingMonth: "2026-09",
          tenantId: "org_1",
          occurredAt: 1_000,
          billableEvents: 5_000,
          countedEventId: "evt_1",
        },
      ]);
    });
  });
});
