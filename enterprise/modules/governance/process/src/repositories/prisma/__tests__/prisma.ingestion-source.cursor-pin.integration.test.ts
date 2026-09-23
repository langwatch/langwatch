/**
 * @vitest-environment node
 * @see specs/ai-gateway/governance/ingestion-sources.feature
 *
 * The report-kind pin under genuine concurrency: a pull run's cursor write is
 * held open until the pinned write is parked on its row lock, then commits.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGovernanceTestConnection } from "../../../app/__tests__/governance-database.fixture.ts";
import { PrismaIngestionSourceRepository } from "../prisma.ingestion-source.repository.ts";
import { raceOnOneRow } from "./support/row-lock-race.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("PrismaIngestionSourceRepository.updateIfCursorUnchanged", () => {
  const connection = createGovernanceTestConnection(databaseUrl ?? "");
  const prisma = connection.client;
  const suffix = nanoid(8);
  const organizationId = `org-cursor-pin-${suffix}`;
  let sourceId: string;

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: `Cursor pin ${suffix}`, slug: `cursor-pin-${suffix}` },
    });
    const source = await prisma.ingestionSource.create({
      data: {
        organizationId,
        sourceType: "http_polling",
        name: "Usage report",
        ingestSecretHash: `hash-${suffix}`,
        parserConfig: { report: "usage" },
      },
    });
    sourceId = source.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  describe("given a pull run commits its cursor while the pinned write is waiting on the row", () => {
    /** @scenario "A report change that waited on a pull run's cursor is refused" */
    it("refuses the write, because the pin re-reads the row it waited for", async () => {
      const answers = await raceOnOneRow<string>({
        prisma,
        table: "IngestionSource",
        first: async (tx) => {
          await tx.ingestionSource.updateMany({
            where: { id: sourceId, organizationId },
            data: { pollerCursor: { startingAt: "2026-08-01T00:00:00Z" } },
          });
          return "pulled";
        },
        second: async () => {
          const updated = await PrismaIngestionSourceRepository.create(
            prisma,
          ).updateIfCursorUnchanged({
            id: sourceId,
            cursor: null,
            update: { parserConfig: { report: "cost" } },
          });
          return updated ? "saved" : "refused";
        },
      });

      expect(answers.second).toBe("refused");
      const stored = await prisma.ingestionSource.findUniqueOrThrow({ where: { id: sourceId } });
      expect(stored.parserConfig).toEqual({ report: "usage" });
    });
  });
});
