/**
 * @vitest-environment node
 *
 * The registry of self-hosted installs against a real Postgres: the rules that
 * depend on the table rather than on the service, which are the upsert keeping
 * the day an install was first seen, the ordering by most recent activity, and
 * the domain search that answers "which install does this company run".
 *
 * @see ../selfHostedInstance.prisma.ts
 * @see specs/self-hosting/connected-services/instance-registry.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaSelfHostedInstances } from "../selfHostedInstance.prisma";
import type { InstanceRowUpsert } from "../selfHostedInstances";

const RUN = `inst-${Date.now()}`;
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);
const NOW = new Date();

function upsertOf(
  overrides: Partial<InstanceRowUpsert> = {},
): InstanceRowUpsert {
  return {
    instanceId: `${RUN}-a`,
    lastSeenAt: YESTERDAY,
    version: "3.16.0",
    installMethod: "helm",
    chartVersion: "1.3.0",
    hostname: `langwatch.${RUN}.acme.test`,
    environment: "production",
    installedAt: null,
    reportSchemaVersion: 2,
    organizationId: null,
    issuedLicenseId: null,
    userEmailDomains: { "acme.test": 12 },
    latestReport: { version: "3.16.0", users: 12 },
    optionalMetricsReported: true,
    hostnameReported: true,
    lastUnknownFields: 0,
    raisedSignals: [],
    ...overrides,
  };
}

describe("the self-hosted instance registry on Postgres", () => {
  const repository = new PrismaSelfHostedInstances(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.selfHostedInstanceReport.deleteMany({
      where: { instanceId: { startsWith: RUN } },
    });
    await prisma.selfHostedInstance.deleteMany({
      where: { instanceId: { startsWith: RUN } },
    });
  });

  describe("given an install that reported yesterday", () => {
    describe("when it reports again with a newer release", () => {
      /** @scenario "A later report updates the same row" */
      it("keeps the day it was first seen and counts the reports", async () => {
        await repository.upsert(upsertOf());
        await repository.appendReport({
          instanceId: `${RUN}-a`,
          receivedAt: YESTERDAY,
          version: "3.16.0",
          reportSchemaVersion: 2,
          unknownFields: 0,
          payload: { version: "3.16.0" },
        });

        await repository.upsert(
          upsertOf({ lastSeenAt: NOW, version: "3.17.0" }),
        );
        await repository.appendReport({
          instanceId: `${RUN}-a`,
          receivedAt: NOW,
          version: "3.17.0",
          reportSchemaVersion: 2,
          unknownFields: 1,
          payload: { version: "3.17.0" },
        });

        const { rows } = await repository.findAll({
          page: 0,
          pageSize: 25,
          search: RUN,
        });
        const row = rows.find((r) => r.instanceId === `${RUN}-a`);

        expect(row).toBeDefined();
        expect(row?.version).toBe("3.17.0");
        expect(row?.reportCount).toBe(2);
        expect(row?.firstSeenAt.getTime()).toBe(YESTERDAY.getTime());
        expect(row?.lastSeenAt.getTime()).toBe(NOW.getTime());
        expect(row?.userEmailDomains).toEqual({ "acme.test": 12 });

        const history = await repository.findReports({
          instanceId: `${RUN}-a`,
          limit: 10,
        });
        expect(history).toHaveLength(2);
        expect(history[0]?.version).toBe("3.17.0");
      });
    });
  });

  describe("given three installs that last reported on different days", () => {
    describe("when the list is read", () => {
      /** @scenario "Installs are listed by most recent activity" */
      it("puts the one that reported most recently first", async () => {
        await repository.upsert(
          upsertOf({
            instanceId: `${RUN}-b`,
            lastSeenAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            hostname: `older.${RUN}.acme.test`,
          }),
        );
        await repository.upsert(
          upsertOf({
            instanceId: `${RUN}-c`,
            lastSeenAt: new Date(Date.now() + 1000),
            hostname: `newest.${RUN}.acme.test`,
          }),
        );

        const { rows } = await repository.findAll({
          page: 0,
          pageSize: 25,
          search: RUN,
        });

        expect(rows[0]?.instanceId).toBe(`${RUN}-c`);
        expect(rows.at(-1)?.instanceId).toBe(`${RUN}-b`);
      });
    });
  });

  describe("given an install whose users are on one domain", () => {
    describe("when the operator searches for that domain", () => {
      /** @scenario "An operator searches by domain, hostname, version or instance id" */
      it("finds the install by the domain flattened out of the counts", async () => {
        const domain = `${RUN}.example.test`;
        await repository.upsert(
          upsertOf({
            instanceId: `${RUN}-d`,
            hostname: null,
            userEmailDomains: { [domain]: 7 },
          }),
        );

        const { rows, total } = await repository.findAll({
          page: 0,
          pageSize: 25,
          search: domain,
        });

        expect(total).toBe(1);
        expect(rows[0]?.instanceId).toBe(`${RUN}-d`);
      });
    });
  });
});
