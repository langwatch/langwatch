/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/instance-registry.feature
 * The install registry on Postgres: first-seen kept, activity order, domain search.
 */
import { nowInstant } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import type { SelfHostedInstanceUpsert } from "../../self-hosted-instance.repository.ts";
import { PrismaSelfHostedInstanceRepository } from "../prisma.self-hosted-instance.repository.ts";
import {
  createLicensingTestConnection,
  TEST_DATABASE_URL,
} from "./support/licensing-database.fixture.ts";

const RUN = `inst-${crypto.randomUUID().slice(0, 8)}`;
const NOW = nowInstant().round({ smallestUnit: "millisecond" });
const YESTERDAY = NOW.subtract({ hours: 24 });

function upsertOf(overrides: Partial<SelfHostedInstanceUpsert> = {}): SelfHostedInstanceUpsert {
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

describe.skipIf(!TEST_DATABASE_URL)("the self-hosted instance registry on Postgres", () => {
  const connection = createLicensingTestConnection(TEST_DATABASE_URL ?? "");
  const prisma = connection.client;
  const repository = PrismaSelfHostedInstanceRepository.create(prisma);

  afterAll(async () => {
    await prisma.selfHostedInstanceReport.deleteMany({
      where: { instanceId: { startsWith: RUN } },
    });
    await prisma.selfHostedInstance.deleteMany({ where: { instanceId: { startsWith: RUN } } });
    await prisma.$disconnect();
  });

  describe("given an install that reported yesterday", () => {
    it("keeps the day it was first seen when it reports a newer release, and counts both", async () => {
      await repository.upsert(upsertOf());
      await repository.appendReport({
        instanceId: `${RUN}-a`,
        receivedAt: YESTERDAY,
        version: "3.16.0",
        reportSchemaVersion: 2,
        unknownFields: 0,
        payload: { version: "3.16.0" },
      });
      await repository.upsert(upsertOf({ lastSeenAt: NOW, version: "3.17.0" }));
      await repository.appendReport({
        instanceId: `${RUN}-a`,
        receivedAt: NOW,
        version: "3.17.0",
        reportSchemaVersion: 2,
        unknownFields: 1,
        payload: { version: "3.17.0" },
      });

      const [row] = await repository.findByInstanceId(`${RUN}-a`);
      expect(row).toMatchObject({
        version: "3.17.0",
        reportCount: 2,
        userEmailDomains: { "acme.test": 12 },
      });
      expect(row?.firstSeenAt.equals(YESTERDAY)).toBe(true);
      expect(row?.lastSeenAt.equals(NOW)).toBe(true);

      const history = await repository.findReports({ instanceId: `${RUN}-a`, limit: 10 });
      expect(history.map((report) => report.version)).toEqual(["3.17.0", "3.16.0"]);
    });
  });

  describe("given installs that last reported on different days", () => {
    it("lists the one that reported most recently first", async () => {
      await repository.upsert(
        upsertOf({
          instanceId: `${RUN}-b`,
          lastSeenAt: NOW.subtract({ hours: 24 * 7 }),
          hostname: `older.${RUN}.acme.test`,
        }),
      );
      await repository.upsert(
        upsertOf({
          instanceId: `${RUN}-c`,
          lastSeenAt: NOW.add({ seconds: 1 }),
          hostname: `newest.${RUN}.acme.test`,
        }),
      );

      const { rows } = await repository.listPage({ page: 0, pageSize: 25, search: RUN });

      expect(rows[0]?.instanceId).toBe(`${RUN}-c`);
      expect(rows.at(-1)?.instanceId).toBe(`${RUN}-b`);
    });
  });

  describe("given an install whose users are on one domain", () => {
    it("finds the install by the domain flattened out of the counts", async () => {
      const domain = `${RUN}.example.test`;
      await repository.upsert(
        upsertOf({ instanceId: `${RUN}-d`, hostname: null, userEmailDomains: { [domain]: 7 } }),
      );

      const { rows, total } = await repository.listPage({ page: 0, pageSize: 25, search: domain });

      expect(total).toBe(1);
      expect(rows[0]?.instanceId).toBe(`${RUN}-d`);
    });
  });
});
