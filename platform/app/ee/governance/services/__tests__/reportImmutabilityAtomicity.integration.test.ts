/**
 * @vitest-environment node
 *
 * The report-immutability pin, against a real Postgres.
 *
 * `reportImmutabilityAtomicity.unit.test.ts` drives a prisma double, so it
 * pins the SHAPE of the pinned write — that the where-clause names the cursor
 * the guard read, that check and write share one transaction — and proves
 * nothing at all about whether Postgres accepts that query. Two things in it
 * are only assertions about a mock until something executes them:
 *
 *   - `Prisma.AnyNull` inside an `updateMany` where-clause on a `Json?`
 *     column. If the query builder rejects it, every report change on a
 *     never-pulled source throws — on precisely the path the pin exists to
 *     keep working.
 *   - That `AnyNull` matches BOTH null flavours the column can hold. The two
 *     writers disagree: a source created without a cursor leaves SQL NULL,
 *     while `ingestion-pull-run-projection.prisma.repository.ts` clears one by
 *     writing `Prisma.JsonNull`, which is the jsonb value `'null'`. Both read
 *     back as JS `null`, so no test that reads through the client can tell
 *     them apart, and a pin that matched only one would refuse a legitimate
 *     edit on half the sources in the table.
 *
 * So these run the real query. The last one is the actual defect the pin was
 * added for: a cursor landing between the guard's read and the write, which
 * before the fix let a report change through on a source that had already
 * started pulling, double-counting the spend it reports.
 *
 * What this file still does NOT prove: serialisation under genuine
 * concurrency. The interleaving is staged deterministically at the boundary
 * (below) rather than by racing two connections, because a real race is
 * timing-dependent and would buy a flaky test in exchange for evidence this
 * already gives. It proves the pin refuses a moved cursor; it does not prove
 * Postgres orders two simultaneous writers.
 *
 * Spec: platform/app/specs/governance/edit-pull-source-config.feature
 *       (Rule: The report kind is fixed once a source has pulled)
 */

import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

const ns = `rpt-atomic-${nanoid(8)}`;
const slug = `--rpt-atomic-${ns}`;

let organizationId: string;

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: `Report Atomicity Org ${ns}`, slug },
  });
  organizationId = organization.id;
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["ingestionSource", { organizationId }],
    ["organization", { slug }],
  ]);
});

/**
 * A source carrying `pollerCursor` exactly as given. `undefined` leaves the
 * column SQL NULL — the state a source is created in — which is a different
 * stored value from the `'null'::jsonb` the projection repository writes when
 * it clears a cursor, even though the client reads both back as `null`.
 */
const seedSource = async ({
  pollerCursor,
  report = "usage",
}: {
  pollerCursor?: unknown;
  report?: string;
}) => {
  const source = await prisma.ingestionSource.create({
    data: {
      organizationId,
      sourceType: "anthropic_admin",
      name: `atomicity ${nanoid(6)}`,
      ingestSecretHash: `sha256:${nanoid(10)}`,
      parserConfig: { adapter: "anthropic_admin", report },
      ...(pollerCursor === undefined
        ? {}
        : { pollerCursor: pollerCursor as never }),
      status: "awaiting_first_event",
    },
  });
  return source.id;
};

const storedReport = async (id: string) => {
  const row = await prisma.ingestionSource.findUnique({ where: { id } });
  return (row?.parserConfig as Record<string, unknown> | null)?.report;
};

const changeReportTo = (report: string) => ({
  adapter: "anthropic_admin",
  report,
});

describe("the report-immutability pin against Postgres", () => {
  describe("given a source that has never pulled", () => {
    describe("when its cursor column is SQL NULL", () => {
      it("accepts the report change", async () => {
        const id = await seedSource({ pollerCursor: undefined });

        await IngestionSourceService.create(prisma).updateSource({
          id,
          organizationId,
          parserConfig: changeReportTo("cost"),
        });

        expect(await storedReport(id)).toBe("cost");
      });
    });

    // The other null. Written by the projection repository when a pull run
    // clears its cursor; indistinguishable from the above through the client.
    describe("when its cursor column holds the jsonb value 'null'", () => {
      it("accepts the report change", async () => {
        const id = await seedSource({ pollerCursor: undefined });
        await prisma.$executeRawUnsafe(
          `-- @tenancy: fixture, single row addressed by primary key
           UPDATE "IngestionSource" SET "pollerCursor" = 'null'::jsonb WHERE id = $1`,
          id,
        );

        await IngestionSourceService.create(prisma).updateSource({
          id,
          organizationId,
          parserConfig: changeReportTo("cost"),
        });

        expect(await storedReport(id)).toBe("cost");
      });
    });

    // A cursor serialised to the empty object still counts as "no content",
    // so the edit is allowed — but the pin now has a real value to match on
    // rather than a null, which is a different branch of the where-clause.
    describe("when its cursor column holds an empty serialised cursor", () => {
      it("accepts the report change", async () => {
        const id = await seedSource({ pollerCursor: "{}" });

        await IngestionSourceService.create(prisma).updateSource({
          id,
          organizationId,
          parserConfig: changeReportTo("cost"),
        });

        expect(await storedReport(id)).toBe("cost");
      });
    });
  });

  describe("given a source that has already pulled", () => {
    it("refuses to change the report", async () => {
      const id = await seedSource({
        pollerCursor: '{"startingAt":"2026-08-01T00:00:00Z"}',
      });

      await expect(
        IngestionSourceService.create(prisma).updateSource({
          id,
          organizationId,
          parserConfig: changeReportTo("cost"),
        }),
      ).rejects.toMatchObject({
        code: "validation_error",
        httpStatus: 422,
      });

      expect(await storedReport(id)).toBe("usage");
    });

    // The pin must not turn into a lock on everything else. A rename touches
    // no report, so it takes the ordinary unpinned write and keeps working
    // however often the source pulls.
    it("still accepts a rename", async () => {
      const id = await seedSource({
        pollerCursor: '{"startingAt":"2026-08-01T00:00:00Z"}',
      });

      const renamed = await IngestionSourceService.create(prisma).updateSource({
        id,
        organizationId,
        name: "renamed while pulling",
      });

      expect(renamed.name).toBe("renamed while pulling");
    });
  });

  describe("given a cursor lands between the guard's read and the write", () => {
    /**
     * The interleaving, staged at the outermost boundary: the client hands the
     * service the row as it genuinely was when `requireById` read it, and the
     * cursor lands immediately after — which is the exact state the service
     * holds when a scheduled pull commits mid-edit. Everything past this point
     * is real: the guard clears the change because the row it was given had no
     * cursor, and the pinned write then meets a row whose cursor has moved.
     */
    const clientThatLandsACursorAfterReading = (id: string): PrismaClient =>
      new Proxy(prisma, {
        get(target, property, receiver) {
          if (property !== "ingestionSource") {
            return Reflect.get(target, property, receiver);
          }
          return new Proxy(target.ingestionSource, {
            get(model, modelProperty, modelReceiver) {
              if (modelProperty !== "findUnique") {
                return Reflect.get(model, modelProperty, modelReceiver);
              }
              return async (args: never) => {
                const stale = await target.ingestionSource.findUnique(args);
                await target.ingestionSource.updateMany({
                  where: { id },
                  data: {
                    pollerCursor: '{"startingAt":"2026-08-01T00:00:00Z"}',
                  },
                });
                return stale;
              };
            },
          });
        },
      }) as PrismaClient;

    it("refuses the write and leaves the report as it was", async () => {
      const id = await seedSource({ pollerCursor: undefined });
      const racing = IngestionSourceService.create(
        clientThatLandsACursorAfterReading(id),
      );

      const refusal = await racing
        .updateSource({
          id,
          organizationId,
          parserConfig: changeReportTo("cost"),
        })
        .then(
          () => null,
          (err: unknown) => err,
        );

      expect(refusal).toMatchObject({
        code: "validation_error",
        httpStatus: 422,
      });
      // Both refusals in this file are `validation_error`, so the code alone
      // would pass even if the guard had rejected for the ordinary
      // already-pulled reason and the pin had never run. The message is the
      // only thing separating them, so it is pinned here and nowhere else.
      expect((refusal as Error).message).toMatch(
        /while the change was being saved/i,
      );

      expect(await storedReport(id)).toBe("usage");
    });
  });
});
