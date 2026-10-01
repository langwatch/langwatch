import { createApiFixture } from "@langwatch/api-fixture";
import type { ReportUsageForMonthCommandData } from "@langwatch/enterprise-billing-contract";
import { createTenantId, type Event, type SubscriberDispatchDefinition } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { BillingApp, type ConnectedBillingPeers } from "../../app/billing.app.ts";
import { billingServer } from "../../billing.server.ts";
import { MemoryBillingRepositories } from "../../repositories/memory/memory.billing.repositories.ts";
import { BillableEventsQueryService } from "../../services/billable-events-query.service.ts";
import { BillingErrorReporterService } from "../../services/billing-error-reporter.service.ts";
import type { ResourceLimitAlertService } from "../../services/resource-limit-alert.service.ts";
import { BillingTenantOrganizationService } from "../../services/tenant-organization.service.ts";
import { StripeUsageReportingUnavailable } from "../../services/usage-reporting.service.ts";
import type { UsageWarningService } from "../../services/usage-warning.service.ts";
import { BILLABLE_EVENTS_METER_PROJECTION_NAME } from "../billable-events-meter.projection.ts";
import { BILLING_METER_DISPATCH_SUBSCRIBER_NAME } from "../billing-meter-dispatch.subscriber.ts";
import {
  BillingReportingPipeline,
  billingReportingEventing,
} from "../billing-reporting.pipeline.ts";

const peers: ConnectedBillingPeers = {
  licensing: createApiFixture<ConnectedBillingPeers["licensing"]>({}),
  operators: { isAdmin: () => false },
  auditLog: createApiFixture<ConnectedBillingPeers["auditLog"]>({}),
  organizations: createApiFixture<ConnectedBillingPeers["organizations"]>({}),
  gateway: createApiFixture<ConnectedBillingPeers["gateway"]>({}),
};

/** The roll-up composed as the app composes it, with the meter where the deployment is SaaS. */
function rollUp({ isSaas }: { isSaas: boolean }) {
  const repositories = MemoryBillingRepositories.create();
  return BillingReportingPipeline.create({
    organizations: repositories.reportOrganizations,
    billingCheckpoints: repositories.checkpoints,
    getUsageReportingService: () => void 0,
    queryBillableEventsTotal: async () => ({ outcome: "unavailable" }),
    queryInstantEvalSpendTotal: async () => ({ outcome: "unavailable" }),
    organizationCache: repositories.organizationCache,
    errorReporter: BillingErrorReporterService.create(),
    connectedUsageCeiling: async () => null,
    meter: isSaas
      ? {
          meter: repositories.billableEventsMeter,
          organizations: BillingTenantOrganizationService.create({
            organizations: { findOrganizationForTenant: async () => "org_1" },
            cache: repositories.tenantOrganizationCache,
          }),
        }
      : void 0,
  });
}

/** The meter's subscribers, as the runtime's global registry would receive them. */
function meterSubscribers(pipeline: BillingReportingPipeline) {
  const definition = pipeline.buildProcessing({ participation: "produce" });
  const subscribers: SubscriberDispatchDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof definition.globalProjections>[number]["register"]>[0]
  >({
    registerMapProjection: () => undefined,
    registerMapSubscriber: (_map, subscriber) => void subscribers.push(subscriber),
  });
  for (const projection of definition.globalProjections ?? []) projection.register(registry);
  return { definition, subscribers };
}

const BILLABLE_EVENT: Event = {
  id: "evt_1",
  aggregateId: "trace_1",
  aggregateType: "trace",
  tenantId: createTenantId("project_alpha"),
  createdAt: 0,
  occurredAt: 0,
  type: "lw.obs.trace.span_received",
  version: "2026-01-01",
  data: {},
};

describe("the monthly billing roll-up's eventing declaration", () => {
  describe("given a deployment that is not SaaS", () => {
    /** @scenario "The monthly roll-up is registered on every install" */
    it("still mounts the command-only roll-up, with no meter beside it", () => {
      const app = BillingApp.assemble({
        usageWarnings: createApiFixture<UsageWarningService>({}),
        resourceLimitAlerts: createApiFixture<ResourceLimitAlertService>({}),
        members: { isSaas: false, nodeEnvironment: "test" },
        repositories: MemoryBillingRepositories.create(),
        config: { bankDetails: undefined, licensePaymentLinkId: undefined },
        peers,
        stripeSecretKey: undefined,
      });

      const pipeline = app.reportingPipeline({ participation: "consume" });

      expect(billingServer.eventing?.pipeline.split(", ")).toContain("billing_reporting");
      expect(billingReportingEventing.pipeline).toBe("billing_reporting");
      expect(pipeline.metadata.name).toBe("billing_reporting");
      expect(pipeline.foldProjections.size + pipeline.mapProjections.size).toBe(0);
      expect(pipeline.globalProjections ?? []).toEqual([]);
    });
  });

  describe("given a SaaS deployment with no Stripe secret", () => {
    const composeSaas = () =>
      BillingApp.assemble({
        usageWarnings: createApiFixture<UsageWarningService>({}),
        resourceLimitAlerts: createApiFixture<ResourceLimitAlertService>({}),
        members: { isSaas: true, nodeEnvironment: "test" },
        repositories: MemoryBillingRepositories.create(),
        config: { bankDetails: undefined, licensePaymentLinkId: undefined },
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

    /** @scenario "A worker mounts the meter only where the deployment is SaaS" */
    it("declares the billable-events meter on the app's roll-up pipeline", () => {
      const pipeline = composeSaas().reportingPipeline({ participation: "produce" });

      expect(pipeline.globalProjections?.map(({ name }) => name)).toEqual([
        BILLABLE_EVENTS_METER_PROJECTION_NAME,
      ]);
    });
  });

  describe("given the roll-up composed with and without the SaaS meter", () => {
    /** @scenario "A worker mounts the meter only where the deployment is SaaS" */
    it("declares the meter and its dispatch subscriber on SaaS only", () => {
      const saas = meterSubscribers(rollUp({ isSaas: true }));
      const selfHosted = meterSubscribers(rollUp({ isSaas: false }));

      expect(saas.definition.globalProjections?.map(({ name }) => name)).toEqual([
        BILLABLE_EVENTS_METER_PROJECTION_NAME,
      ]);
      expect(saas.subscribers.map(({ name }) => name)).toEqual([
        BILLING_METER_DISPATCH_SUBSCRIBER_NAME,
      ]);
      expect(selfHosted.definition.globalProjections ?? []).toEqual([]);
    });

    /** @scenario "A SaaS worker meters only through the pipeline its reports are sent through" */
    it("reports nothing before registration and the month through reportUsageForMonth after", async () => {
      const pipeline = rollUp({ isSaas: true });
      const { subscribers } = meterSubscribers(pipeline);
      const [dispatch] = subscribers;
      const context = { tenantId: "project_alpha", aggregateId: "trace_1", foldState: void 0 };
      const reported: ReportUsageForMonthCommandData[] = [];

      await dispatch?.handle(BILLABLE_EVENT, context);
      expect(reported).toEqual([]);

      pipeline.connectSelfDispatch(async (data) => void reported.push(data));
      await dispatch?.handle(BILLABLE_EVENT, context);

      expect(reported).toContainEqual(
        expect.objectContaining({
          organizationId: "org_1",
          billingMonth: BillableEventsQueryService.getBillingMonth(nowInstant()),
        }),
      );
    });
  });
});
