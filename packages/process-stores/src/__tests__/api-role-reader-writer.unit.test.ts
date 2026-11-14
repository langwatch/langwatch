/**
 * @vitest-environment node
 * The api's stores over the reader and the writer credentials alone (ADR-202 Decided 3, 12, 14):
 * its eventing checks no aggregate index, so it sends no statement that skips the tenant check,
 * and its inserts leave on the writer.
 * @see specs/clickhouse/app-reader-identity.feature · specs/clickhouse/app-writer-identity.feature
 */
import {
  ClickHouseQueryClient,
  type InsertRequest,
  type QueryRequest,
  type SkippedTenantCheck,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";

import type { EventingConfig, ProcessConfig } from "../config.ts";
import { buildProcessStores } from "../create-members.ts";

const PRODUCER: EventingConfig = {
  store: { kind: "producer-only" },
  consumersEnabled: false,
  executionTarget: "web",
  processManagerMode: "producer-only",
};

const CONSUMER: EventingConfig = {
  store: { kind: "event-log", defaultRetentionDays: 30 },
  consumersEnabled: true,
  executionTarget: "worker",
  processManagerMode: "run",
};

/** A role's stores over a client holding the reader and the writer, recording what each is sent. */
function storesOver({ eventing }: { eventing: EventingConfig }) {
  const skipped: SkippedTenantCheck[] = [];
  const sent: QueryRequest[] = [];
  const written: InsertRequest[] = [];
  const refuse = () => Promise.reject(new Error("the reader runs reads only"));
  const refuseRead = () => Promise.reject(new Error("the writer runs inserts only"));
  const clickhouse = new ClickHouseQueryClient({
    tenantGuard: new TenantGuard({ onUnscoped: (skip) => skipped.push(skip) }),
    readerDriver: {
      execute: <Row>(request: QueryRequest) => {
        sent.push(request);
        return Promise.resolve({ rows: [] as Row[] });
      },
      command: refuse,
      insert: refuse,
    },
    writerDriver: {
      execute: refuseRead,
      command: refuseRead,
      insert: (request: InsertRequest) => {
        written.push(request);
        return Promise.resolve();
      },
    },
  });
  const config: ProcessConfig = {
    processName: "api-role-reader-only-test",
    encryptionKey: "0".repeat(64),
    secrets: {},
    rateLimit: { requests: 60, seconds: 60 },
    clickhouse: {
      readerUrl: "http://reader.invalid:8123",
      writerUrl: "http://writer.invalid:8123",
    },
    eventing,
  };
  const stores = buildProcessStores({
    config,
    members: { clickhouse, prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }) },
  });
  return { stores, skipped, sent, written, clickhouse };
}

const DSPY_INSERT: InsertRequest = {
  tenantId: "project_1",
  table: "dspy_steps",
  rows: [{ TenantId: "project_1" }],
};

describe("given a role's stores over the reader and the writer credentials alone", () => {
  describe("when the api's producer eventing is built", () => {
    /** @scenario "The api's eventing checks no event-log index, so it sends no skip-check statement" */
    it("sends no statement that skips the tenant check", async () => {
      const consumer = storesOver({ eventing: CONSUMER });
      const producer = storesOver({ eventing: PRODUCER });
      try {
        consumer.stores.members.read("eventing");
        producer.stores.members.read("eventing");

        // The draining role's index check is what the producer would have sent.
        await vi.waitFor(() => expect(consumer.skipped.length).toBeGreaterThan(0));
        expect(producer.skipped).toEqual([]);
        expect(producer.sent).toEqual([]);
      } finally {
        await producer.stores.members.close();
        await consumer.stores.members.close();
      }
    });
  });

  describe("when the api's producer eventing is built and an insert is sent", () => {
    /** @scenario "The api's stores boot with the reader and the writer credentials alone" */
    it("skips no tenant check and sends the insert on the writer", async () => {
      const producer = storesOver({ eventing: PRODUCER });
      try {
        producer.stores.members.read("eventing");
        await producer.clickhouse.insert(DSPY_INSERT);

        expect(producer.skipped).toEqual([]);
        expect(producer.sent).toEqual([]);
        expect(producer.written).toEqual([DSPY_INSERT]);
      } finally {
        await producer.stores.members.close();
      }
    });
  });
});
