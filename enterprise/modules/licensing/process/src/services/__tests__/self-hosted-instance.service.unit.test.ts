import type { IncomingUsageReport } from "@langwatch/enterprise-licensing-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { CloudCustomer, SelfHostedOrgTraits } from "../../app/licensing.members.ts";
import { MemoryIssuedLicenseRepository } from "../../repositories/memory/memory.issued-license.repository.ts";
import { MemorySelfHostedInstanceRepository } from "../../repositories/memory/memory.self-hosted-instance.repository.ts";
import { SelfHostedCrmService } from "../self-hosted-crm.service.ts";
import { SelfHostedInstanceService } from "../self-hosted-instance.service.ts";

const NOW = Temporal.Instant.from("2026-09-22T12:00:00Z");
const OPTIONAL_KEYS = new Set(["user_email_domains", "hostname", "active_users_28d"]);

type Recorded = {
  slack: { headline: string; organizationName: string | null; leadingDomain: string | null }[];
  groups: { groupId: string; traits: SelfHostedOrgTraits }[];
  events: string[];
  domainLookups: string[];
};

function registry({
  representative,
  cloudDomains = [],
  crmFails = false,
  withCrm = true,
}: {
  representative?: CloudCustomer;
  cloudDomains?: string[];
  crmFails?: boolean;
  withCrm?: boolean;
} = {}) {
  const recorded: Recorded = { slack: [], groups: [], events: [], domainLookups: [] };
  const repository = MemorySelfHostedInstanceRepository.create();
  const licenses = MemoryIssuedLicenseRepository.create();
  const crm = SelfHostedCrmService.create({
    customers: {
      findRepresentatives: async () => (representative ? [representative] : []),
      hasAccountOnDomain: async (domain) => {
        recorded.domainLookups.push(domain);
        return cloudDomains.includes(domain);
      },
    },
    notifications: {
      sendSlackSelfHostedSignal: async (payload) => {
        recorded.slack.push(payload);
      },
    },
    nurturing: {
      groupUser: async ({ groupId, traits }) => {
        if (crmFails) throw new Error("customer.io is down");
        recorded.groups.push({ groupId, traits });
      },
      trackEvent: async ({ event }) => {
        recorded.events.push(event);
      },
    },
    baseUrl: "https://app.langwatch.ai",
  });
  const service = SelfHostedInstanceService.create({
    repository,
    licenses,
    organizations: {
      findById: async (id) => ({ id, name: "Acme" }),
    },
    optionalReportKeys: OPTIONAL_KEYS,
    ...(withCrm ? { crm } : {}),
    now: () => NOW,
  });
  return { service, repository, licenses, recorded };
}

function report(overrides: Partial<IncomingUsageReport> = {}): IncomingUsageReport {
  return {
    instanceId: "instance-1",
    properties: { version: "3.4.0", install_method: "helm", users: 3 },
    unknownFields: 0,
    receivedAt: NOW.toString(),
    ...overrides,
  };
}

async function bindLicense(licenses: MemoryIssuedLicenseRepository) {
  const row = await licenses.create({
    licenseId: "lic-1",
    tokenHash: "hash",
    organizationId: "org-1",
    organizationName: "Acme",
    email: "ops@acme.test",
    planType: "ENTERPRISE",
    maxMembers: 50,
    maxMembersLite: 0,
    issuedAt: NOW.subtract({ hours: 24 * 300 }),
    expiresAt: NOW.add({ hours: 24 * 30 }),
    source: "BACKOFFICE",
    issuedById: null,
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
    supersededAt: null,
    replacesId: null,
    pendingDeliveryLicense: null,
    services: [],
    seatRateCents: null,
    seatCurrency: null,
    commitUsdCents: 0,
    overageEnabled: false,
    overageMaxUsdCents: null,
    instanceId: null,
    instanceBoundAt: null,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    virtualKeyId: null,
  });
  await licenses.bindInstance({ id: row.id, instanceId: "instance-1", at: NOW });
  return row;
}

describe("SelfHostedInstanceService", () => {
  describe("when an install reports", () => {
    /** @scenario "The first report from an install creates its row" */
    it("creates the row from the report's fields", async () => {
      const { service } = registry();
      await service.recordReport(report());
      const { instances } = await service.list({ page: 0, pageSize: 10 });
      expect(instances).toMatchObject([
        { instanceId: "instance-1", version: "3.4.0", installMethod: "helm", reportCount: 1 },
      ]);
    });

    /** @scenario "A later report updates the same row" */
    it("updates the same row and keeps the day it was first heard from", async () => {
      const { service } = registry();
      await service.recordReport(report({ receivedAt: NOW.subtract({ hours: 48 }).toString() }));
      await service.recordReport(report({ properties: { version: "3.5.0" } }));
      const { instances, total } = await service.list({ page: 0, pageSize: 10 });
      expect(total).toBe(1);
      expect(instances[0]).toMatchObject({
        version: "3.5.0",
        reportCount: 2,
        firstSeenAt: NOW.subtract({ hours: 48 }).toString(),
      });
    });

    /** @scenario "A report can never claim a customer" */
    it("ignores an organization named in the report body", async () => {
      const { service } = registry();
      await service.recordReport(report({ properties: { organization_id: "org-victim" } }));
      const { instances } = await service.list({ page: 0, pageSize: 10 });
      expect(instances[0]).toMatchObject({ organizationId: null, issuedLicenseId: null });
    });

    /** @scenario "A report from an install holding a license is attributed to its customer" */
    it("attributes the row to the license bound to that instance", async () => {
      const { service, licenses } = registry();
      const license = await bindLicense(licenses);
      await service.recordReport(report());
      const { instances } = await service.list({ page: 0, pageSize: 10 });
      expect(instances[0]).toMatchObject({
        organizationId: "org-1",
        issuedLicenseId: license.id,
        organizationName: "Acme",
      });
    });

    /** @scenario "A customer who switched the optional category off is recorded as having done so" */
    it("records whether any optional key arrived and whether the hostname did", async () => {
      const { service } = registry();
      await service.recordReport(report());
      const { instances } = await service.list({ page: 0, pageSize: 10 });
      expect(instances[0]).toMatchObject({
        optionalMetricsReported: false,
        hostnameReported: false,
      });
    });
  });

  describe("when an operator reads the registry", () => {
    /** @scenario "Installs are listed by most recent activity" */
    it("lists the most recently active install first, with its activity", async () => {
      const { service } = registry();
      await service.recordReport(
        report({ instanceId: "old", receivedAt: NOW.subtract({ hours: 24 * 20 }).toString() }),
      );
      await service.recordReport(report({ instanceId: "new" }));
      const { instances } = await service.list({ page: 0, pageSize: 10 });
      expect(instances.map((row) => [row.instanceId, row.activity])).toEqual([
        ["new", "reporting"],
        ["old", "gone"],
      ]);
    });

    /** @scenario "An operator searches by domain, hostname, version or instance id" */
    it("matches part of a hostname and the whole of a domain", async () => {
      const { service } = registry();
      await service.recordReport(
        report({
          properties: { hostname: "llm.acme.internal", user_email_domains: { "acme.com": 4 } },
        }),
      );
      await service.recordReport(report({ instanceId: "other" }));
      const byHost = await service.list({ page: 0, pageSize: 10, search: "ACME.int" });
      const byDomain = await service.list({ page: 0, pageSize: 10, search: "acme.com" });
      expect(byHost.instances.map((row) => row.instanceId)).toEqual(["instance-1"]);
      expect(byDomain.instances.map((row) => row.instanceId)).toEqual(["instance-1"]);
    });

    it("refuses an unknown row by code", async () => {
      const { service } = registry();
      await expect(service.getById({ id: "missing" })).rejects.toMatchObject({
        code: "self_hosted_instance_not_found",
      });
    });
  });

  describe("when a report raises a signal", () => {
    /** @scenario "The lookup for an already-raised signal is not made again" */
    it("asks about the leading domain only until that signal was raised", async () => {
      const { service, recorded } = registry({ cloudDomains: ["acme.com"] });
      const withDomains = report({
        properties: { user_email_domains: { "acme.com": 9, "gmail.com": 2 } },
      });
      await expect(service.recordReport(withDomains)).resolves.toEqual([
        "domain_has_cloud_account",
      ]);
      await expect(service.recordReport(withDomains)).resolves.toEqual([]);
      expect(recorded.domainLookups).toEqual(["acme.com"]);
    });

    /** @scenario "A raised signal reaches Slack with the install behind it" */
    it("posts the headline with the install's leading domain", async () => {
      const { service, recorded } = registry({ cloudDomains: ["acme.com"] });
      await service.recordReport(report({ properties: { user_email_domains: { "acme.com": 3 } } }));
      expect(recorded.slack).toMatchObject([
        {
          headline: "A self-hosted install is run by a company we already know",
          leadingDomain: "acme.com",
        },
      ]);
    });

    /** @scenario "An install bound to a customer gets its traits on that customer" */
    it("writes traits and one event per signal through the customer's representative", async () => {
      const { service, licenses, recorded } = registry({
        representative: { userId: "user-1", organizationName: "Acme" },
      });
      await bindLicense(licenses);
      await service.recordReport(report({ properties: { users: 30 } }));
      expect(recorded.groups).toMatchObject([
        { groupId: "org-1", traits: { self_hosted: true, self_hosted_users: 30 } },
      ]);
      expect(recorded.events).toEqual([
        "self_hosted_seats_crossed_threshold",
        "self_hosted_license_expiring",
      ]);
    });

    /** @scenario "An install with no license reaches Slack and no CRM record" */
    it("reaches Slack alone when no license binds the install", async () => {
      const { service, recorded } = registry({
        representative: { userId: "user-1", organizationName: "Acme" },
      });
      await service.recordReport(report({ properties: { users: 30 } }));
      expect(recorded.slack).toHaveLength(1);
      expect(recorded.groups).toEqual([]);
    });

    /** @scenario "The CRM failing never fails the report" */
    it("keeps the report when the CRM refuses", async () => {
      const { service, licenses } = registry({
        representative: { userId: "user-1", organizationName: "Acme" },
        crmFails: true,
      });
      await bindLicense(licenses);
      await expect(service.recordReport(report({ properties: { users: 30 } }))).resolves.toContain(
        "seats_crossed_threshold",
      );
    });

    it("raises nothing where nothing is listening", async () => {
      const { service } = registry({ withCrm: false });
      await expect(service.recordReport(report({ properties: { users: 30 } }))).resolves.toEqual(
        [],
      );
    });
  });
});
