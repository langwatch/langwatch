// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The other half of the report-kind rule: the guard's answer is only worth
 * what the write does with it.
 *
 * `assertReportUnchangedOncePulled` clears a report change by reading that the
 * source has no poller cursor. That read and the update it clears are separate
 * statements, and a pull run finishing between them gives the source a cursor
 * — so the update lands on a source that has pulled, which is precisely the
 * state the guard refuses whenever it can see it. The outcome is the one the
 * adapter's header calls impossible: the same spend counted once under each
 * report, with nothing colliding and nothing complaining.
 *
 * So these tests are about the write, not the decision. They assert that the
 * cleared-on-an-empty-cursor path carries that cursor into its `where` and
 * abandons the transaction when it matches nothing, and — just as important —
 * that every other edit keeps the plain unpinned update, because a rename that
 * fails whenever a scheduled pull happens to land in the same second is a
 * worse bug than the one being fixed.
 *
 * Spec: specs/governance/edit-pull-source-config.feature
 */

import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";

const ORG = "org_1";
const SOURCE_ID = "src_1";

const rowWith = (over: Record<string, unknown> = {}) =>
  ({
    id: SOURCE_ID,
    organizationId: ORG,
    teamId: null,
    sourceType: "anthropic_admin",
    name: "Anthropic admin",
    description: null,
    ingestSecretHash: "sha256:whatever",
    parserConfig: { adapter: "anthropic_admin", report: "usage" },
    pollerCursor: null,
    errorCount: 0,
    pullSchedule: null,
    status: "awaiting_first_event",
    traceProjectId: null,
    lastEventAt: null,
    archivedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    createdById: null,
    ...over,
  }) as unknown as Awaited<ReturnType<IngestionSourceService["findById"]>>;

/**
 * A prisma double that records what it was asked, and can be told to answer
 * the pinned write with a miss — which is what a cursor written in the gap
 * looks like from inside the transaction.
 *
 * The pin is SQL, so what is recorded for it is the statement text (with a
 * `?` where each value is bound) and the bound values in order.
 */
const fakePrisma = ({
  row,
  cursorMovedInTheGap = false,
}: {
  row: ReturnType<typeof rowWith>;
  cursorMovedInTheGap?: boolean;
}) => {
  const pinned: Array<{ sql: string; values: unknown[] }> = [];
  const executeRaw = vi
    .fn()
    .mockImplementation(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        pinned.push({ sql: strings.join("?"), values });
        return Promise.resolve(cursorMovedInTheGap ? 0 : 1);
      },
    );
  const update = vi.fn().mockImplementation(({ data }: { data: unknown }) =>
    Promise.resolve(
      rowWith({
        ...(data as Record<string, unknown>),
      }),
    ),
  );
  const client = {
    ingestionSource: {
      findUnique: vi.fn().mockResolvedValue(row),
      update,
    },
    $executeRaw: executeRaw,
    $transaction: vi.fn(
      (run: (tx: unknown) => Promise<unknown>) => run(client) as Promise<never>,
    ),
  };
  return {
    client: client as unknown as PrismaClient,
    update,
    executeRaw,
    pinned,
    transaction: client.$transaction,
  };
};

const anthropic = (report: string) => ({
  adapter: "anthropic_admin",
  report,
});

describe("updateSource, on the path the report guard cleared", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a report change on a source that has never pulled", () => {
    it("pins the write to the absent cursor the decision was made on", async () => {
      // Either null, not one of them: the column is `Json?` and its two
      // writers disagree about which null they leave behind — a JSON null
      // from the projection repository, SQL NULL from a source that never
      // ran. Both read back as JS `null`, so a pin that matched only one of
      // them would refuse the ordinary case it exists to allow.
      const { client, pinned, update } = fakePrisma({ row: rowWith() });

      await IngestionSourceService.create(client).updateSource({
        id: SOURCE_ID,
        organizationId: ORG,
        parserConfig: anthropic("cost"),
      });

      expect(pinned).toHaveLength(1);
      expect(pinned[0]?.sql).toMatch(
        /"pollerCursor" IS NULL OR "pollerCursor" = 'null'::jsonb/,
      );
      expect(pinned[0]?.values).toEqual([SOURCE_ID, ORG]);
      expect(update).toHaveBeenCalledOnce();
    });

    it("runs the check and the write inside one transaction", async () => {
      // The pin alone would still leave the puller free to write its cursor
      // between the matching pin and the `update`. The pin is a write, so it
      // holds the row lock for the rest of the transaction and a pull
      // arriving after it waits rather than interleaves.
      const { client, transaction } = fakePrisma({ row: rowWith() });

      await IngestionSourceService.create(client).updateSource({
        id: SOURCE_ID,
        organizationId: ORG,
        parserConfig: anthropic("cost"),
      });

      expect(transaction).toHaveBeenCalledOnce();
    });

    it("abandons the update when a cursor lands in the gap", async () => {
      const { client, update } = fakePrisma({
        row: rowWith(),
        cursorMovedInTheGap: true,
      });

      await expect(
        IngestionSourceService.create(client).updateSource({
          id: SOURCE_ID,
          organizationId: ORG,
          parserConfig: anthropic("cost"),
        }),
      ).rejects.toThrow(/started pulling while the change was being saved/);

      // The point of the whole exercise: the row is left exactly as the pull
      // run left it, rather than carrying a report its cursor no longer matches.
      expect(update).not.toHaveBeenCalled();
    });

    it("pins to the stored value when the empty cursor is a serialised one", async () => {
      // `hasPollerCursor` reads "{}" as no cursor, so the guard clears the
      // change — and the pin has to name that same value, not null, or the
      // write would refuse itself.
      const { client, pinned } = fakePrisma({
        row: rowWith({ pollerCursor: "{}" }),
      });

      await IngestionSourceService.create(client).updateSource({
        id: SOURCE_ID,
        organizationId: ORG,
        parserConfig: anthropic("cost"),
      });

      expect(pinned).toHaveLength(1);
      expect(pinned[0]?.sql).toMatch(/"pollerCursor" = \?::jsonb/);
      // The stored value is the JSON string "{}", so the pin names that
      // string, serialised as the jsonb it compares against.
      expect(pinned[0]?.values).toEqual([SOURCE_ID, ORG, '"{}"']);
    });
  });

  describe("given an edit that does not turn on the cursor", () => {
    it("renames without pinning anything", async () => {
      // A rename never reaches the guard. Pinning it would fail an edit for
      // the sole reason that a scheduled pull ran while the drawer was open.
      const { client, executeRaw, transaction } = fakePrisma({
        row: rowWith(),
      });

      await IngestionSourceService.create(client).updateSource({
        id: SOURCE_ID,
        organizationId: ORG,
        name: "Anthropic admin (finance)",
      });

      expect(executeRaw).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it("saves a config that keeps the same report without pinning", async () => {
      // The common config edit — a rotated key, a moved bucket width. The
      // report is unchanged, so no cursor arriving later can make this write
      // wrong, and it should not be made to fail on one.
      const { client, executeRaw, transaction } = fakePrisma({
        row: rowWith(),
      });

      await IngestionSourceService.create(client).updateSource({
        id: SOURCE_ID,
        organizationId: ORG,
        parserConfig: { ...anthropic("usage"), bucketWidth: "1h" },
      });

      expect(executeRaw).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it("does not pin a source whose stored config names no report", async () => {
      // A push-mode source, or an adapter with no report axis: there is no
      // invariant here for a cursor to invalidate.
      const { client, executeRaw } = fakePrisma({
        row: rowWith({ parserConfig: { workspaceId: "w_1" } }),
      });

      await IngestionSourceService.create(client).updateSource({
        id: SOURCE_ID,
        organizationId: ORG,
        parserConfig: { workspaceId: "w_2" },
      });

      expect(executeRaw).not.toHaveBeenCalled();
    });
  });
});
