// @vitest-environment node
// ADR-094 Decisions 2, 5 and 9. The invariants under test:
//   - Totals conserve: attributed + unattributed + unattributable = ledger.
//   - Period-correct attribution: money goes to whoever owned the login THEN.
//   - Buckets come from the ingest-time mark, never from a missing link.
//   - Closed periods never change silently.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { IdentityErasureTokenService } from "~/server/identity-links/erasure-token.service";

import type { AttributionLedgerRow } from "../usageAttributionLedger.clickhouse.repository";
import { UsageAttributionReportService } from "../usageAttributionReport.service";

const SECRET = "c".repeat(64);
const ORG = "org-a";
const TENANT = "gov-project-1";
const CONN = "conn-anthropic";

const JAN = new Date("2026-01-01T00:00:00Z");
const MAR = new Date("2026-03-01T00:00:00Z");
const MAR_15 = new Date("2026-03-15T00:00:00Z");
const APR = new Date("2026-04-01T00:00:00Z");

const at = (iso: string) => new Date(iso).getTime();

const ledgerRow = (
  overrides: Partial<AttributionLedgerRow> = {},
): AttributionLedgerRow => ({
  sourceId: CONN,
  actorUserId: "mem-1",
  actorEmail: "alice@example.com",
  actorType: "person",
  actorTypeId: 1,
  traceId: `trace-${Math.random()}`,
  events: 1,
  spendUsd: 10,
  firstEventMs: at("2026-01-15T00:00:00Z"),
  ...overrides,
});

const linkRow = (overrides: Record<string, unknown> = {}) => ({
  id: `link-${Math.random()}`,
  seq: 1n,
  organizationId: ORG,
  provider: "anthropic",
  providerConnectionId: CONN,
  externalKind: "member_id",
  externalId: "mem-1",
  userId: "alice",
  effectiveFrom: JAN,
  recordedAt: JAN,
  source: "manual",
  actorUserId: "admin-1",
  erasedAt: null,
  ...overrides,
});

interface Fixture {
  ledgerRows: AttributionLedgerRow[];
  links: Array<Record<string, unknown>>;
  sources: Array<{ id: string; sourceType: string }>;
  users: Array<{ id: string; name: string | null; email: string | null }>;
  lastExport: { exportedAt: Date; periodTo: Date } | null;
  backdatedCount: number;
}

const makeService = (fixture: Partial<Fixture> = {}) => {
  const state: Fixture = {
    ledgerRows: [],
    links: [],
    sources: [{ id: CONN, sourceType: "claude_compliance" }],
    users: [{ id: "alice", name: "Alice Example", email: "alice@example.com" }],
    lastExport: null,
    backdatedCount: 0,
    ...fixture,
  };

  const createdExports: unknown[] = [];
  const prisma = {
    ingestionSource: {
      findMany: vi.fn().mockImplementation(() => state.sources),
    },
    providerIdentityLink: {
      // The storage matches on the full 4-tuple; the stub answers the same
      // way so a ref built with the wrong kind finds nothing here too.
      findMany: vi.fn().mockImplementation(({ where }: any) =>
        state.links.filter((row) =>
          (where.OR as any[]).some(
            (ref) =>
              ref.provider === row.provider &&
              ref.providerConnectionId === row.providerConnectionId &&
              ref.externalKind === row.externalKind &&
              ref.externalId === row.externalId,
          ),
        ),
      ),
      count: vi.fn().mockImplementation(() => state.backdatedCount),
    },
    user: { findMany: vi.fn().mockImplementation(() => state.users) },
    attributionReportExport: {
      findFirst: vi.fn().mockImplementation(() => state.lastExport),
      create: vi.fn().mockImplementation((args: any) => {
        createdExports.push(args.data);
        return args.data;
      }),
    },
  };

  const ledger = {
    findLedger: vi.fn().mockImplementation(() => state.ledgerRows),
  };

  const service = new UsageAttributionReportService(
    prisma as unknown as PrismaClient,
    ledger as never,
    new IdentityErasureTokenService(SECRET),
  );

  return { service, state, prisma, createdExports };
};

const report = (service: UsageAttributionReportService, from = JAN, to = APR) =>
  service.report({ organizationId: ORG, tenantId: TENANT, from, to });

describe("UsageAttributionReportService", () => {
  describe("totals conserve (ADR-094 Invariants)", () => {
    it("adds the three buckets back up to the raw ledger, for events AND spend", async () => {
      const ledgerRows = [
        // Attributed: linked person.
        ledgerRow({ events: 3, spendUsd: 12.5 }),
        // Unattributed: a person-kind login nobody has claimed.
        ledgerRow({
          actorUserId: "mem-unclaimed",
          actorEmail: "nobody@example.com",
          events: 2,
          spendUsd: 4,
        }),
        // Unattributable: the adapter declared a service principal.
        ledgerRow({
          actorUserId: "svc-1",
          actorEmail: "",
          actorType: "service_principal",
          actorTypeId: 3,
          events: 7,
          spendUsd: 0.75,
        }),
        // A row with no identifier at all — never dropped, never a machine.
        ledgerRow({
          actorUserId: "",
          actorEmail: "",
          events: 1,
          spendUsd: 2,
        }),
      ];
      const { service } = makeService({
        ledgerRows,
        links: [linkRow()],
      });

      const result = await report(service);

      // The un-bucketed truth, computed the way a raw query would.
      const rawEvents = ledgerRows.reduce((sum, row) => sum + row.events, 0);
      const rawSpend = ledgerRows.reduce((sum, row) => sum + row.spendUsd, 0);

      const { attributed, unattributed, unattributable, ledger } =
        result.totals;
      expect(attributed.events + unattributed.events + unattributable.events)
        .toBe(rawEvents);
      expect(
        attributed.spendUsd + unattributed.spendUsd + unattributable.spendUsd,
      ).toBeCloseTo(rawSpend, 10);
      expect(ledger).toEqual({ events: rawEvents, spendUsd: rawSpend });

      expect(attributed.events).toBe(3);
      expect(unattributable.events).toBe(7);
      // The unclaimed login plus the identifier-less row.
      expect(unattributed.events).toBe(3);
    });

    describe("when a login resolves to nobody", () => {
      it("keeps it in the report rather than dropping it", async () => {
        const { service } = makeService({
          ledgerRows: [ledgerRow({ events: 5, spendUsd: 9 })],
          links: [],
        });

        const result = await report(service);
        expect(result.totals.ledger.events).toBe(5);
        expect(result.totals.unattributed.events).toBe(5);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]!.displayName).toBeNull();
      });
    });
  });

  describe("buckets come from the ingest-time mark (ADR-094 Decision 5)", () => {
    it("never infers unattributable from a missing link", async () => {
      const { service } = makeService({
        ledgerRows: [ledgerRow({ actorUserId: "mem-nobody-linked-this" })],
        links: [],
      });

      const result = await report(service);
      expect(result.totals.unattributable.events).toBe(0);
      expect(result.rows[0]!.bucket).toBe("unattributed");
    });

    it("reads a bot as unattributable even when a link happens to exist", async () => {
      const { service } = makeService({
        ledgerRows: [
          ledgerRow({ actorType: "bot", actorTypeId: 3, events: 4 }),
        ],
        links: [linkRow()],
      });

      const result = await report(service);
      expect(result.rows[0]!.bucket).toBe("unattributable");
      expect(result.rows[0]!.displayName).toBeNull();
    });

    describe("when the row carries no actor type at all", () => {
      // Push-path rows write none. Defaulting them to person keeps a linkable
      // row visible instead of hiding it behind "can never resolve".
      it("treats it as a person, so it stays linkable", async () => {
        const { service } = makeService({
          ledgerRows: [ledgerRow({ actorType: "", actorTypeId: 0 })],
          links: [linkRow()],
        });

        const result = await report(service);
        expect(result.rows[0]!.bucket).toBe("attributed");
      });
    });
  });

  describe("period-correct attribution (ADR-094 Invariants)", () => {
    describe("given links backfilled late for a login that changed hands", () => {
      // Alice Jan–Feb, Bob from March. A single whole-range lookup would hand
      // January's money to Bob; the ADR bans exactly that.
      it("puts January on Alice and March on Bob", async () => {
        const { service } = makeService({
          ledgerRows: [
            ledgerRow({
              firstEventMs: at("2026-01-20T00:00:00Z"),
              events: 1,
              spendUsd: 100,
            }),
            ledgerRow({
              firstEventMs: at("2026-03-20T00:00:00Z"),
              events: 1,
              spendUsd: 30,
            }),
          ],
          links: [
            linkRow({ seq: 1n, userId: "alice", effectiveFrom: JAN }),
            linkRow({ seq: 2n, userId: "bob", effectiveFrom: MAR }),
          ],
          users: [
            { id: "alice", name: "Alice Example", email: null },
            { id: "bob", name: "Bob Example", email: null },
          ],
        });

        const result = await report(service);
        const byName = Object.fromEntries(
          result.rows.map((row) => [row.displayName, row]),
        );
        expect(byName["Alice Example"]!.spendUsd).toBe(100);
        expect(byName["Bob Example"]!.spendUsd).toBe(30);
        expect(result.totals.attributed.spendUsd).toBe(130);
      });
    });

    describe("given a handover in the middle of the reported month", () => {
      it("splits March at the boundary rather than giving it to either side", async () => {
        const { service } = makeService({
          ledgerRows: [
            ledgerRow({
              firstEventMs: at("2026-03-10T00:00:00Z"),
              spendUsd: 40,
            }),
            // Usage AT the boundary goes to the NEW owner.
            ledgerRow({
              firstEventMs: MAR_15.getTime(),
              spendUsd: 5,
            }),
            ledgerRow({
              firstEventMs: at("2026-03-20T00:00:00Z"),
              spendUsd: 60,
            }),
          ],
          links: [
            linkRow({ seq: 1n, userId: "alice", effectiveFrom: JAN }),
            linkRow({ seq: 2n, userId: "bob", effectiveFrom: MAR_15 }),
          ],
          users: [
            { id: "alice", name: "Alice Example", email: null },
            { id: "bob", name: "Bob Example", email: null },
          ],
        });

        const result = await report(service, MAR, APR);
        const byName = Object.fromEntries(
          result.rows.map((row) => [row.displayName, row]),
        );
        expect(byName["Alice Example"]!.spendUsd).toBe(40);
        expect(byName["Bob Example"]!.spendUsd).toBe(65);
      });
    });

    describe("given two rows sharing an effectiveFrom", () => {
      it("lets the later seq win, every time", async () => {
        const links = [
          linkRow({ seq: 7n, userId: "alice", effectiveFrom: MAR }),
          linkRow({ seq: 8n, userId: "bob", effectiveFrom: MAR }),
        ];
        const { service } = makeService({
          ledgerRows: [ledgerRow({ firstEventMs: at("2026-03-10T00:00:00Z") })],
          links,
          users: [
            { id: "alice", name: "Alice Example", email: null },
            { id: "bob", name: "Bob Example", email: null },
          ],
        });

        const result = await report(service);
        expect(result.rows[0]!.userId).toBe("bob");

        // Same rows, other insertion order — the answer must not move.
        const reversed = makeService({
          ledgerRows: [ledgerRow({ firstEventMs: at("2026-03-10T00:00:00Z") })],
          links: [...links].reverse(),
          users: [
            { id: "alice", name: "Alice Example", email: null },
            { id: "bob", name: "Bob Example", email: null },
          ],
        });
        expect((await report(reversed.service)).rows[0]!.userId).toBe("bob");
      });
    });
  });

  describe("typed ids beat addresses (ADR-094 Decision 2)", () => {
    describe("when the typed timeline covers the moment", () => {
      it("believes it, even where an email timeline says otherwise", async () => {
        const { service } = makeService({
          ledgerRows: [ledgerRow()],
          links: [
            linkRow({ externalKind: "member_id", userId: "alice" }),
            linkRow({
              externalKind: "email",
              externalId: "alice@example.com",
              userId: "bob",
            }),
          ],
          users: [
            { id: "alice", name: "Alice Example", email: null },
            { id: "bob", name: "Bob Example", email: null },
          ],
        });

        const result = await report(service);
        expect(result.rows[0]!.userId).toBe("alice");
      });

      describe("and the typed timeline says the link was closed", () => {
        // A closed typed link is an ANSWER, not a gap — an admin decided. The
        // weaker email evidence must not quietly undo it.
        it("stays unattributed rather than falling back to the address", async () => {
          const { service } = makeService({
            ledgerRows: [ledgerRow()],
            links: [
              linkRow({
                externalKind: "member_id",
                userId: null,
                effectiveFrom: JAN,
              }),
              linkRow({
                externalKind: "email",
                externalId: "alice@example.com",
                userId: "bob",
              }),
            ],
          });

          const result = await report(service);
          expect(result.rows[0]!.bucket).toBe("unattributed");
        });
      });
    });

    describe("when the typed timeline is silent", () => {
      it("consults the address", async () => {
        const { service } = makeService({
          ledgerRows: [ledgerRow()],
          links: [
            linkRow({
              externalKind: "email",
              externalId: "alice@example.com",
              userId: "alice",
            }),
          ],
        });

        const result = await report(service);
        expect(result.rows[0]!.userId).toBe("alice");
      });

      it("matches the address whatever casing the provider sent", async () => {
        const { service } = makeService({
          ledgerRows: [ledgerRow({ actorEmail: "  Alice@Example.COM " })],
          links: [
            linkRow({
              externalKind: "email",
              externalId: "alice@example.com",
              userId: "alice",
            }),
          ],
        });

        expect((await report(service)).rows[0]!.userId).toBe("alice");
      });
    });
  });

  describe("an erased person (ADR-094 Decision 9)", () => {
    it("stays attributed, shown as a former member, with their spend where it was", async () => {
      const token = new IdentityErasureTokenService(SECRET).tokenFor({
        organizationId: ORG,
        email: "alice@example.com",
      });
      const { service } = makeService({
        ledgerRows: [ledgerRow({ actorUserId: "", spendUsd: 55 })],
        links: [
          // What erasure left behind: the address swapped for its token, the
          // person blanked, `erasedAt` stamped.
          linkRow({
            externalKind: "email",
            externalId: token,
            userId: null,
            erasedAt: new Date("2026-02-01T00:00:00Z"),
          }),
        ],
      });

      const result = await report(service);
      expect(result.rows[0]!.bucket).toBe("attributed");
      expect(result.rows[0]!.displayName).toBe("former member (erased)");
      expect(result.rows[0]!.userId).toBeNull();
      expect(result.totals.attributed.spendUsd).toBe(55);
    });

    describe("when the instance has no erasure key configured", () => {
      it("still produces a report rather than failing", async () => {
        const { service, state } = makeService({
          ledgerRows: [ledgerRow()],
          links: [linkRow()],
        });
        void state;
        const keyless = new UsageAttributionReportService(
          (service as never as { prisma: PrismaClient }).prisma,
          (service as never as { ledger: never }).ledger,
          null,
        );

        const result = await report(keyless);
        expect(result.totals.ledger.events).toBe(1);
      });
    });
  });

  describe("freshness copy (ADR-094 Constants)", () => {
    it("appears for a provider that restates its own numbers", async () => {
      const { service } = makeService({ ledgerRows: [ledgerRow()] });
      expect((await report(service)).freshness).toBe(
        "complete through watermark − 30 days",
      );
    });

    describe("when no source in the window restates", () => {
      it("says nothing, so the notice keeps meaning something", async () => {
        const { service } = makeService({
          ledgerRows: [ledgerRow()],
          sources: [{ id: CONN, sourceType: "copilot_studio" }],
        });
        expect((await report(service)).freshness).toBeNull();
      });
    });
  });

  describe("closed periods never change silently (ADR-094 Invariants)", () => {
    describe("given nothing has been exported yet", () => {
      it("carries no notice", async () => {
        const { service } = makeService({ ledgerRows: [ledgerRow()] });
        expect((await report(service)).changeNotice).toBeNull();
      });
    });

    describe("given a link was backdated into an already-exported period", () => {
      it("carries the notice", async () => {
        const { service } = makeService({
          ledgerRows: [ledgerRow()],
          lastExport: {
            exportedAt: new Date("2026-04-02T00:00:00Z"),
            periodTo: APR,
          },
          backdatedCount: 1,
        });

        expect((await report(service)).changeNotice).toBe(
          "attribution changed for already-reported periods",
        );
      });
    });

    describe("given the export itself", () => {
      it("records the window and the session's actor, and returns the report", async () => {
        const { service, createdExports } = makeService({
          ledgerRows: [ledgerRow()],
        });

        const result = await service.export({
          organizationId: ORG,
          tenantId: TENANT,
          from: JAN,
          to: APR,
          actorUserId: "admin-42",
        });

        expect(result.totals.ledger.events).toBe(1);
        expect(createdExports).toEqual([
          {
            organizationId: ORG,
            periodFrom: JAN,
            periodTo: APR,
            actorUserId: "admin-42",
          },
        ]);
      });
    });
  });

  describe("batched lookups", () => {
    let fixture: ReturnType<typeof makeService>;

    beforeEach(async () => {
      fixture = makeService({
        ledgerRows: Array.from({ length: 25 }, (_, index) =>
          ledgerRow({ traceId: `trace-${index}` }),
        ),
        links: [linkRow()],
      });
      await report(fixture.service);
    });

    // A per-row lookup would turn a report into one round trip per trace.
    it("asks for the ingestion sources once", () => {
      expect(fixture.prisma.ingestionSource.findMany).toHaveBeenCalledTimes(1);
    });

    it("asks for the link timelines once", () => {
      expect(fixture.prisma.providerIdentityLink.findMany).toHaveBeenCalledTimes(
        1,
      );
    });

    it("asks for the display names once", () => {
      expect(fixture.prisma.user.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("organization isolation", () => {
    it("never asks for a connection without naming the organization", async () => {
      const { service, prisma } = makeService({
        ledgerRows: [ledgerRow()],
        links: [linkRow()],
      });
      await report(service);

      const where = prisma.ingestionSource.findMany.mock.calls[0]![0].where;
      expect(where.organizationId).toBe(ORG);
      expect(where.id.in).toEqual([CONN]);
    });
  });
});
