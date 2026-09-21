/**
 * What a usage report leaves behind, and what it can never claim.
 *
 * The write path here is public and unauthenticated, so the test that matters
 * most is the one proving a report cannot name a customer: the organization on
 * an install's row comes from the licence bound to that instance and from
 * nowhere else.
 *
 * @see ../selfHostedInstance.service.ts
 * @see specs/self-hosting/connected-services/instance-registry.feature
 * @see specs/self-hosting/connected-services/self-hosted-lead-signals.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SelfHostedInstanceService } from "../selfHostedInstance.service";
import type {
  InstanceReportInsert,
  InstanceRowUpsert,
  SelfHostedInstanceRecord,
} from "../selfHostedInstances";

const NOW = new Date("2026-09-21T12:00:00.000Z");
const INSTANCE = "3f1c2b40-9a7e-4f2a-8f4c-6b1f0c2d9e77";

function recordOf(
  overrides: Partial<SelfHostedInstanceRecord> = {},
): SelfHostedInstanceRecord {
  return {
    id: "row-1",
    instanceId: INSTANCE,
    firstSeenAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSeenAt: NOW,
    version: "3.17.0",
    installMethod: "helm",
    chartVersion: "1.4.0",
    hostname: "langwatch.acme.test",
    environment: "production",
    installedAt: null,
    reportSchemaVersion: 2,
    organizationId: null,
    issuedLicenseId: null,
    userEmailDomains: null,
    latestReport: null,
    optionalMetricsReported: true,
    hostnameReported: true,
    reportCount: 4,
    lastUnknownFields: 0,
    raisedSignals: [],
    ...overrides,
  };
}

/**
 * A store that actually stores, so a read-back after the upsert answers what
 * the upsert wrote. The service reads the row back before announcing, and a
 * stub that forgot would make that path untestable.
 */
function storeOver(rows: SelfHostedInstanceRecord[] = []) {
  const upserts: InstanceRowUpsert[] = [];
  const reports: InstanceReportInsert[] = [];
  const byInstance = new Map(rows.map((row) => [row.instanceId, row]));

  return {
    upserts,
    reports,
    repository: {
      upsert: vi.fn(async (row: InstanceRowUpsert) => {
        upserts.push(row);
        const existing = byInstance.get(row.instanceId);
        byInstance.set(row.instanceId, {
          ...recordOf({ instanceId: row.instanceId }),
          ...(existing ?? {}),
          ...row,
          firstSeenAt: existing?.firstSeenAt ?? row.lastSeenAt,
          reportCount: (existing?.reportCount ?? 0) + 1,
        });
      }),
      appendReport: vi.fn(async (report: InstanceReportInsert) => {
        reports.push(report);
      }),
      findAll: vi.fn(async () => {
        const all = [...byInstance.values()];
        return { rows: all, total: all.length };
      }),
      findById: vi.fn(
        async (id: string) =>
          [...byInstance.values()].find((row) => row.id === id) ?? null,
      ),
      findByInstanceId: vi.fn(
        async (instanceId: string) => byInstance.get(instanceId) ?? null,
      ),
      findReports: vi.fn(async () => []),
    },
  };
}

/** A stand-in for the CRM that records what it was asked and what it was told. */
function crmSpy(hasAccount = false) {
  return {
    hasAccountOnDomain: vi.fn(async () => hasAccount),
    announce: vi.fn(async () => undefined),
  };
}

function serviceOver({
  store,
  owner = null,
  names = {},
  crm = crmSpy(),
}: {
  store: ReturnType<typeof storeOver>;
  owner?: {
    organizationId: string | null;
    issuedLicenseId: string | null;
    expiresAt: Date | null;
  } | null;
  names?: Record<string, string | undefined>;
  crm?: ReturnType<typeof crmSpy> | null;
}) {
  return new SelfHostedInstanceService({
    repository: store.repository,
    owners: { findByInstanceId: vi.fn(async () => owner) },
    organizations: { findNames: vi.fn(async () => names) },
    crm,
    now: () => NOW,
  });
}

const FULL_REPORT = {
  version: "3.17.0",
  install_method: "helm",
  chart_version: "1.4.0",
  hostname: "langwatch.acme.test",
  environment: "production",
  report_schema_version: 2,
  first_seen_at: "2026-01-01T00:00:00.000Z",
  users: 14,
  projects: 3,
  user_email_domains: { "acme.test": 12, "other.test": 2 },
  first_project_at: "2026-01-02T00:00:00.000Z",
  totalTraces: 98_000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given a report from an install that has never reported", () => {
  describe("when it is written down", () => {
    /** @scenario "The first report from an install creates its row" */
    it("creates the row and keeps the report as history", async () => {
      const store = storeOver();
      await serviceOver({ store }).recordReport({
        instanceId: INSTANCE,
        properties: FULL_REPORT,
        unknownFields: 0,
        receivedAt: NOW,
      });

      expect(store.upserts).toHaveLength(1);
      expect(store.upserts[0]).toMatchObject({
        instanceId: INSTANCE,
        lastSeenAt: NOW,
        version: "3.17.0",
        installMethod: "helm",
        chartVersion: "1.4.0",
        hostname: "langwatch.acme.test",
        reportSchemaVersion: 2,
        userEmailDomains: { "acme.test": 12, "other.test": 2 },
        optionalMetricsReported: true,
        hostnameReported: true,
      });
      expect(store.upserts[0]?.installedAt).toEqual(
        new Date("2026-01-01T00:00:00.000Z"),
      );

      expect(store.reports).toHaveLength(1);
      expect(store.reports[0]).toMatchObject({
        instanceId: INSTANCE,
        version: "3.17.0",
        unknownFields: 0,
      });
      expect(store.reports[0]?.payload).toEqual(FULL_REPORT);
    });
  });
});

describe("given a report whose body names an organization", () => {
  describe("when it is written down", () => {
    /** @scenario "A report can never claim a customer" */
    it("carries no organization, because the body holds no credential", async () => {
      const store = storeOver();
      await serviceOver({ store }).recordReport({
        instanceId: INSTANCE,
        properties: {
          ...FULL_REPORT,
          organizationId: "org-someone-else",
          issuedLicenseId: "license-someone-else",
        },
        unknownFields: 2,
        receivedAt: NOW,
      });

      expect(store.upserts[0]?.organizationId).toBeNull();
      expect(store.upserts[0]?.issuedLicenseId).toBeNull();
      expect(store.upserts[0]?.lastUnknownFields).toBe(2);
    });
  });
});

describe("given an install holding a license bound to this instance", () => {
  describe("when it reports", () => {
    /** @scenario "A report from an install holding a license is attributed to its customer" */
    it("names the license and the customer the registry holds", async () => {
      const store = storeOver();
      await serviceOver({
        store,
        owner: {
          organizationId: "org-acme",
          issuedLicenseId: "license-1",
          expiresAt: new Date("2027-09-21T00:00:00.000Z"),
        },
      }).recordReport({
        instanceId: INSTANCE,
        properties: FULL_REPORT,
        unknownFields: 0,
        receivedAt: NOW,
      });

      expect(store.upserts[0]?.organizationId).toBe("org-acme");
      expect(store.upserts[0]?.issuedLicenseId).toBe("license-1");
    });
  });
});

describe("given an install reporting only the standard and operational blocks", () => {
  describe("when it is written down", () => {
    /** @scenario "A customer who switched the optional category off is recorded as having done so" */
    it("records the category as switched off and stores no domains", async () => {
      const store = storeOver();
      await serviceOver({ store }).recordReport({
        instanceId: INSTANCE,
        properties: {
          version: "3.17.0",
          install_method: "docker",
          report_schema_version: 2,
          organizations: 1,
          teams: 1,
          projects: 2,
          users: 5,
          connected: false,
        },
        unknownFields: 0,
        receivedAt: NOW,
      });

      expect(store.upserts[0]?.optionalMetricsReported).toBe(false);
      expect(store.upserts[0]?.hostnameReported).toBe(false);
      expect(store.upserts[0]?.userEmailDomains).toBeNull();
    });
  });
});

describe("given a report that raises a signal", () => {
  describe("when it is written down", () => {
    /** @scenario "A raised signal reaches Slack with the install behind it" */
    it("records the signal on the row and announces it once", async () => {
      const store = storeOver();
      const crm = crmSpy(true);

      const raised = await serviceOver({ store, crm }).recordReport({
        instanceId: INSTANCE,
        properties: { ...FULL_REPORT, users: 40 },
        unknownFields: 0,
        receivedAt: NOW,
      });

      expect(raised).toContain("seats_crossed_threshold");
      expect(raised).toContain("domain_has_cloud_account");
      expect(store.upserts[0]?.raisedSignals).toEqual(raised);
      expect(crm.announce).toHaveBeenCalledTimes(1);
      // The largest domain is the one that names the company.
      expect(crm.announce.mock.calls[0]?.[0]).toMatchObject({
        leadingDomain: "acme.test",
        signals: raised,
      });
    });
  });
});

describe("given an install that already raised the domain signal", () => {
  describe("when its report arrives", () => {
    /** @scenario "The lookup for an already-raised signal is not made again" */
    it("does not ask Cloud about that domain again", async () => {
      const store = storeOver([
        recordOf({ raisedSignals: ["domain_has_cloud_account"] }),
      ]);
      const crm = crmSpy(true);

      const raised = await serviceOver({ store, crm }).recordReport({
        instanceId: INSTANCE,
        properties: FULL_REPORT,
        unknownFields: 0,
        receivedAt: NOW,
      });

      expect(crm.hasAccountOnDomain).not.toHaveBeenCalled();
      expect(raised).toEqual([]);
      expect(crm.announce).not.toHaveBeenCalled();
    });
  });
});

describe("given installs that last reported on different days", () => {
  describe("when the list is read", () => {
    /** @scenario "Installs are listed by most recent activity" */
    it("says which are still reporting, which went quiet and which are gone", async () => {
      const store = storeOver([
        recordOf({ id: "a", lastSeenAt: NOW }),
        recordOf({
          id: "b",
          instanceId: "instance-b",
          lastSeenAt: new Date("2026-09-15T12:00:00.000Z"),
        }),
        recordOf({
          id: "c",
          instanceId: "instance-c",
          lastSeenAt: new Date("2026-06-01T12:00:00.000Z"),
          organizationId: "org-acme",
        }),
      ]);

      const { instances, total } = await serviceOver({
        store,
        names: { "org-acme": "ACME" },
      }).getAll({ page: 0, pageSize: 25 });

      expect(total).toBe(3);
      expect(instances.map((i) => i.activity)).toEqual([
        "reporting",
        "quiet",
        "gone",
      ]);
      expect(instances[2]?.organizationName).toBe("ACME");
      expect(instances[0]?.organizationName).toBeNull();
    });
  });
});

describe("given an install that is not in the registry", () => {
  describe("when it is opened", () => {
    it("answers with nothing rather than an empty row", async () => {
      const store = storeOver();
      const found = await serviceOver({ store }).getById({ id: "missing" });
      expect(found).toBeNull();
    });
  });
});
