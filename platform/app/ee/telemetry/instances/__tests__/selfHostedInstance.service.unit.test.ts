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

function storeOver(rows: SelfHostedInstanceRecord[] = []) {
  const upserts: InstanceRowUpsert[] = [];
  const reports: InstanceReportInsert[] = [];
  return {
    upserts,
    reports,
    repository: {
      upsert: vi.fn(async (row: InstanceRowUpsert) => {
        upserts.push(row);
      }),
      appendReport: vi.fn(async (report: InstanceReportInsert) => {
        reports.push(report);
      }),
      findAll: vi.fn(async () => ({ rows, total: rows.length })),
      findById: vi.fn(
        async (id: string) => rows.find((r) => r.id === id) ?? null,
      ),
      findReports: vi.fn(async () => []),
    },
  };
}

function serviceOver({
  store,
  owner = null,
  names = {},
}: {
  store: ReturnType<typeof storeOver>;
  owner?: {
    organizationId: string | null;
    issuedLicenseId: string | null;
  } | null;
  names?: Record<string, string | undefined>;
}) {
  return new SelfHostedInstanceService({
    repository: store.repository,
    owners: { findByInstanceId: vi.fn(async () => owner) },
    organizations: { findNames: vi.fn(async () => names) },
    now: () => NOW,
  });
}

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
    ...overrides,
  };
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
        owner: { organizationId: "org-acme", issuedLicenseId: "license-1" },
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

beforeEach(() => {
  vi.clearAllMocks();
});
