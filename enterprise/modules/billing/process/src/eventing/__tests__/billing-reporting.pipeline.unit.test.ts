import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it } from "vitest";

import { BillingApp, type ConnectedBillingPeers } from "../../app/billing.app.ts";
import { billingServer } from "../../billing.server.ts";
import { MemoryBillingRepositories } from "../../repositories/memory/memory.billing.repositories.ts";
import { StripeUsageReportingUnavailable } from "../../services/usage-reporting.service.ts";
import { billingReportingEventing } from "../billing-reporting.pipeline.ts";

const peers: ConnectedBillingPeers = {
  licensing: createApiFixture<ConnectedBillingPeers["licensing"]>({}),
  operators: { isAdmin: () => false },
  auditLog: createApiFixture<ConnectedBillingPeers["auditLog"]>({}),
  organizations: createApiFixture<ConnectedBillingPeers["organizations"]>({}),
  gateway: createApiFixture<ConnectedBillingPeers["gateway"]>({}),
};

describe("the monthly billing roll-up's eventing declaration", () => {
  describe("given a deployment that is not SaaS", () => {
    /** @scenario "The monthly roll-up is registered on every install" */
    it("still mounts the command-only roll-up, with no meter beside it", () => {
      const app = BillingApp.assemble({
        members: { isSaas: false, nodeEnvironment: "test" },
        repositories: MemoryBillingRepositories.create(),
        config: { bankDetails: undefined },
        peers,
        stripeSecretKey: undefined,
      });

      const pipeline = app.reportingPipeline({ participation: "consume" });

      expect(billingServer.eventing?.pipeline.split(", ")).toContain("billing_reporting");
      expect(billingReportingEventing.pipeline).toBe("billing_reporting");
      expect(pipeline.metadata.name).toBe("billing_reporting");
      expect(pipeline.foldProjections.size + pipeline.mapProjections.size).toBe(0);
    });
  });

  describe("given a SaaS deployment with no Stripe secret", () => {
    const composeSaas = () =>
      BillingApp.assemble({
        members: { isSaas: true, nodeEnvironment: "test" },
        repositories: MemoryBillingRepositories.create(),
        config: { bankDetails: undefined },
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
});
