import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  type EventingClickHouseClient,
} from "@langwatch/eventing/server";
import { describe, expect, it, vi } from "vitest";

import type { EventRecord } from "../../../../stores/repositories/eventRepository.types.ts";

const retention = createEventingRetentionConfiguration({ defaultRetentionDays: 49 });

/** The inserts each tenant's client was handed, in the order they were sent. */
type SentInsert = { tenantId: string; tenants: string[]; tenantIds: readonly string[] | undefined };

function recordOf(tenantId: string): EventRecord {
  return {
    TenantId: tenantId,
    AggregateType: "user",
    AggregateId: tenantId,
    EventId: `event-of-${tenantId}`,
    EventTimestamp: 1_700_000_000_000,
    EventOccurredAt: 1_700_000_000_000,
    EventType: "lw.user.created",
    EventVersion: "1",
    EventPayload: {},
    ProcessingTraceparent: "",
    IdempotencyKey: `key-of-${tenantId}`,
  };
}

/** A server whose inserts hold until released, and refuse where `refuses` says so. */
function heldServer({
  organizationOf,
  refuses = () => false,
}: {
  organizationOf: (tenantId: string) => string;
  refuses?: (insert: SentInsert) => boolean;
}) {
  const sent: SentInsert[] = [];
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const clientOf = (tenantId: string): EventingClickHouseClient => ({
    query: async () => ({ json: async () => [] }),
    insert: async (request) => {
      const insert = {
        tenantId,
        tenants: request.values.map((row) => String(row.TenantId)),
        tenantIds: request.tenantIds,
      };
      sent.push(insert);
      await released;
      if (refuses(insert)) throw new Error(`refused ${insert.tenants.join(",")}`);
      return undefined;
    },
  });
  const repository = EventingClickHouseEventRepository.create({
    resolveClient: async (tenantId) => clientOf(tenantId),
    retention,
    organizationOf: async (tenantId) => organizationOf(tenantId),
  });
  const append = (tenantId: string) => repository.insertEventRecords([recordOf(tenantId)]);
  return { sent, release, append };
}

/** Starts the four inserts an organisation holds at once, so later appends wait and fold. */
async function saturate({
  append,
  sent,
  tenants,
}: {
  append: (tenantId: string) => Promise<void>;
  sent: SentInsert[];
  tenants: readonly string[];
}): Promise<Promise<void>[]> {
  const before = sent.length;
  const running = tenants.map((tenantId) => append(tenantId));
  await vi.waitFor(() => expect(sent).toHaveLength(before + tenants.length));
  return running;
}

describe("EventingClickHouseEventRepository appends folded per organisation", () => {
  describe("given an organisation whose inserts are all in flight", () => {
    /** @scenario "Appends that wait while their organisation's inserts are busy leave as one insert" */
    it("sends the waiting appends of several tenants as one insert declaring them", async () => {
      const { sent, release, append } = heldServer({ organizationOf: () => "org-a" });
      const running = await saturate({ append, sent, tenants: ["u1", "u2", "u3", "u4"] });
      let answered = false;
      const waiting = Promise.all(["u5", "u6", "u7"].map((tenantId) => append(tenantId))).then(
        () => {
          answered = true;
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(sent).toHaveLength(4);
      expect(answered).toBe(false);

      release();
      await Promise.all([...running, waiting]);

      expect(sent.slice(0, 4).map((insert) => insert.tenantIds)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      expect(sent.slice(4)).toEqual([
        { tenantId: "u5", tenants: ["u5", "u6", "u7"], tenantIds: ["u5", "u6", "u7"] },
      ]);
    });
  });

  describe("given an organisation with no insert in flight", () => {
    /** @scenario "An append that finds a free insert goes out alone" */
    it("inserts the append alone, declaring no tenant set", async () => {
      const { sent, release, append } = heldServer({ organizationOf: () => "org-a" });
      release();

      await append("u1");

      expect(sent).toEqual([{ tenantId: "u1", tenants: ["u1"], tenantIds: undefined }]);
    });
  });

  describe("given two organisations whose inserts are all in flight", () => {
    /** @scenario "Appends of different organisations never share an insert" */
    it("folds each organisation's waiting appends into an insert of its own", async () => {
      const { sent, release, append } = heldServer({
        organizationOf: (tenantId) => (tenantId.startsWith("a") ? "org-a" : "org-b"),
      });
      const running = await saturate({
        append,
        sent,
        tenants: ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"],
      });
      const waiting = ["a5", "b5", "a6", "b6"].map((tenantId) => append(tenantId));

      release();
      await Promise.all([...running, ...waiting]);

      const folded = sent.filter((insert) => insert.tenantIds !== undefined);
      const declared = folded.map((insert) => (insert.tenantIds ?? []).join(","));
      expect(declared.toSorted((a, b) => a.localeCompare(b))).toEqual(["a5,a6", "b5,b6"]);
    });
  });

  describe("given appends folded into one shared insert that fails", () => {
    /** @scenario "A shared insert that fails is retried as each append alone" */
    it("retries each append alone, failing only the one whose own insert fails", async () => {
      const { sent, release, append } = heldServer({
        organizationOf: () => "org-a",
        refuses: (insert) => insert.tenantIds !== undefined || insert.tenants.includes("bad"),
      });
      const running = await saturate({ append, sent, tenants: ["u1", "u2", "u3", "u4"] });
      const outcomes = ["u5", "bad", "u6"].map((tenantId) =>
        append(tenantId).then(
          () => "stored",
          () => "failed",
        ),
      );

      release();
      await Promise.all(running);

      expect(await Promise.all(outcomes)).toEqual(["stored", "failed", "stored"]);
      expect(sent.slice(4).map((insert) => insert.tenants)).toEqual([
        ["u5", "bad", "u6"],
        ["u5"],
        ["bad"],
        ["u6"],
      ]);
    });
  });
});
