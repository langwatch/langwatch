/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/license-sync.feature
 * The single identity row on Postgres, written before anything minted it.
 */
import { nowInstant } from "@langwatch/time";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaInstanceIdentityRepository } from "../prisma.instance-identity.repository.ts";
import {
  createLicensingTestConnection,
  TEST_DATABASE_URL,
} from "./support/licensing-database.fixture.ts";

const RUN = `ident-${crypto.randomUUID().slice(0, 8)}`;

describe.skipIf(!TEST_DATABASE_URL)("the instance identity row on Postgres", () => {
  const connection = createLicensingTestConnection(TEST_DATABASE_URL ?? "");
  const prisma = connection.client;
  const repository = PrismaInstanceIdentityRepository.create(prisma);

  beforeEach(async () => {
    await prisma.instanceIdentity.deleteMany({});
  });

  afterAll(async () => {
    await prisma.instanceIdentity.deleteMany({});
    await prisma.$disconnect();
  });

  describe("when the switches are written on an install with no row", () => {
    /** @scenario "The usage report switches persist on an install with no identity row yet" */
    it("creates the row holding both switches", async () => {
      await repository.setReportSwitches({
        switches: { optionalMetricsOptOut: true, hostnameOptOut: true },
        instanceIdIfMissing: `${RUN}-a`,
      });

      expect(await repository.findRow()).toMatchObject({
        instanceId: `${RUN}-a`,
        optionalMetricsOptOut: true,
        hostnameOptOut: true,
      });
    });
  });

  describe("when the row already exists", () => {
    it("changes only the switch that was named and keeps the identity", async () => {
      await repository.mint(`${RUN}-b`);
      await repository.setReportSwitches({
        switches: { hostnameOptOut: true },
        instanceIdIfMissing: `${RUN}-other`,
      });

      expect(await repository.findRow()).toMatchObject({
        instanceId: `${RUN}-b`,
        optionalMetricsOptOut: false,
        hostnameOptOut: true,
      });
    });
  });

  describe("when two processes write the switches first at once", () => {
    /** @scenario "Two first writes of the usage report switches end with one identity row" */
    it("ends with one row", async () => {
      await Promise.all([
        repository.setReportSwitches({
          switches: { optionalMetricsOptOut: true },
          instanceIdIfMissing: `${RUN}-c1`,
        }),
        repository.setReportSwitches({
          switches: { hostnameOptOut: true },
          instanceIdIfMissing: `${RUN}-c2`,
        }),
        repository.mint(`${RUN}-c3`),
      ]);

      const rows = await prisma.instanceIdentity.findMany({});
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ optionalMetricsOptOut: true, hostnameOptOut: true });
    });
  });

  describe("when a report lands on an install with no row", () => {
    /** @scenario "A usage report sent before any identity row existed is still recorded" */
    it("creates the row with the time the report landed", async () => {
      const at = nowInstant().round({ smallestUnit: "millisecond" });

      await repository.recordReport({ error: null, at, instanceIdIfMissing: `${RUN}-d` });

      const row = await repository.findRow();
      expect(row?.instanceId).toBe(`${RUN}-d`);
      expect(row?.lastReportAt?.toString()).toBe(at.toString());
    });
  });
});
