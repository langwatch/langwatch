/**
 * @vitest-environment node
 * @see specs/ai-gateway/governance/ingestion-sources.feature
 *
 * The received-event stamp on the real table: conditional writes, so a disable that lands
 * while a batch is in flight is never overwritten back to active.
 */
import { randomBytes } from "node:crypto";

import type { Prisma } from "@langwatch/prisma-client/generated";
import { aesEncryption } from "@langwatch/process-stores";
import { Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGovernanceTestConnection } from "../../../app/__tests__/governance-database.fixture.ts";
import { PrismaIngestionSourceRepository } from "../prisma.ingestion-source.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const STAMPED_AT = Temporal.Instant.fromEpochMilliseconds(Date.parse("2026-11-13T10:00:00.000Z"));

describe.skipIf(!databaseUrl)("PrismaIngestionSourceRepository.recordEventReceived", () => {
  const connection = createGovernanceTestConnection(databaseUrl ?? "");
  const prisma = connection.client;
  const suffix = nanoid(8);
  const organizationId = `org-event-stamp-${suffix}`;
  const repository = PrismaIngestionSourceRepository.create({
    database: prisma,
    cipher: aesEncryption(randomBytes(32)),
  });

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: `Event stamp ${suffix}`, slug: `event-stamp-${suffix}` },
    });
  });

  afterAll(async () => {
    await prisma.ingestionSource.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  /** Holds the source's row lock in its own transaction, as a slower writer does. */
  async function holdRowLock({
    id,
    inside,
  }: {
    id: string;
    inside?: (tx: Prisma.TransactionClient) => Promise<unknown>;
  }): Promise<() => Promise<void>> {
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => {};
    const isHeld = new Promise<void>((resolve) => {
      held = resolve;
    });
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "IngestionSource" WHERE "id" = ${id} FOR UPDATE`;
        if (inside) await inside(tx);
        held();
        await released;
      },
      { timeout: 30_000 },
    );
    await isHeld;
    return async () => {
      release();
      await done;
    };
  }

  /** Waits until this many stamp writes are parked on the row lock, past any read first. */
  async function writesParkedOnTheRow(count: number): Promise<void> {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const [row] = await prisma.$queryRaw<{ parked: bigint }[]>`
        SELECT count(*) AS parked FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND query ILIKE '%UPDATE%IngestionSource%'`;
      if (Number(row?.parked ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`expected ${count} stamp writes parked on the row lock`);
  }

  async function sourceWith(status: "awaiting_first_event" | "active" | "disabled") {
    const source = await prisma.ingestionSource.create({
      data: {
        organizationId,
        sourceType: "otel_generic",
        name: `OTel ${status} ${nanoid(8)}`,
        ingestSecretHash: `hash-${status}-${suffix}`,
        parserConfig: {},
        status,
      },
    });
    return source.id;
  }

  describe("given a source still awaiting its first event", () => {
    /** @scenario "The first batch a source receives makes it active" */
    it("makes it active and stamps the last event time", async () => {
      const id = await sourceWith("awaiting_first_event");

      await repository.recordEventReceived({ id, status: "awaiting_first_event" }, STAMPED_AT);

      const stored = await prisma.ingestionSource.findUniqueOrThrow({ where: { id } });
      expect(stored.status).toBe("active");
      expect(stored.lastEventAt?.toISOString()).toBe("2026-11-13T10:00:00.000Z");
    });

    /** @scenario "A source's first data records that it went live, once" */
    it("says exactly one of racing stamps moved it live, and stamps every later one", async () => {
      const id = await sourceWith("awaiting_first_event");
      const later = Temporal.Instant.fromEpochMilliseconds(Date.parse("2026-11-13T11:00:00.000Z"));
      // Every racing batch read the source before any stamp, so each tries the first-event write;
      // a held row lock parks all three writes at once, so they truly overlap.
      const asRead = { id, status: "awaiting_first_event" };
      const release = await holdRowLock({ id });

      const stamping = Promise.all([
        repository.recordEventReceived(asRead, STAMPED_AT),
        repository.recordEventReceived(asRead, STAMPED_AT),
        repository.recordEventReceived(asRead, STAMPED_AT),
      ]);
      await writesParkedOnTheRow(3);
      await release();
      const racing = await stamping;
      const after = await repository.recordEventReceived({ id, status: "active" }, later);

      expect(racing.filter(({ wentLive }) => wentLive)).toHaveLength(1);
      expect(after).toEqual({ wentLive: false });
      const stored = await prisma.ingestionSource.findUniqueOrThrow({ where: { id } });
      expect(stored.lastEventAt?.toISOString()).toBe("2026-11-13T11:00:00.000Z");
    });
  });

  describe("given the admin disabled the source after its batch was let in", () => {
    /** @scenario "A batch in flight when the source is disabled does not re-enable it" */
    it("leaves the source disabled and its last event time alone", async () => {
      const id = await sourceWith("disabled");

      // The batch was let in on the source as read before the disable.
      const asRead = { id, status: "awaiting_first_event" };
      const stamp = await repository.recordEventReceived(asRead, STAMPED_AT);

      expect(stamp).toEqual({ wentLive: false });
      const stored = await prisma.ingestionSource.findUniqueOrThrow({ where: { id } });
      expect(stored.status).toBe("disabled");
      expect(stored.lastEventAt).toBeNull();
    });

    /** @scenario "A batch in flight when the source is disabled does not re-enable it" */
    it("leaves it disabled when the disable commits while the stamp waits on the row", async () => {
      const id = await sourceWith("active");
      const release = await holdRowLock({
        id,
        inside: (tx) => tx.ingestionSource.update({ where: { id }, data: { status: "disabled" } }),
      });

      const stamping = repository.recordEventReceived({ id, status: "active" }, STAMPED_AT);
      await writesParkedOnTheRow(1);
      await release();

      expect(await stamping).toEqual({ wentLive: false });
      const stored = await prisma.ingestionSource.findUniqueOrThrow({ where: { id } });
      expect(stored.status).toBe("disabled");
      expect(stored.lastEventAt).toBeNull();
    });
  });
});
