/**
 * @vitest-environment node
 * The api's stores over the reader credential alone (ADR-202 Decided 3): its eventing reads the
 * event log but checks no aggregate index, so it sends no statement that skips the tenant check.
 * @see specs/clickhouse/app-reader-identity.feature
 */
import {
  ClickHouseQueryClient,
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

/** A role's stores over a client holding only the reader, recording every statement it is asked. */
function storesOver({ eventing }: { eventing: EventingConfig }) {
  const skipped: SkippedTenantCheck[] = [];
  const sent: QueryRequest[] = [];
  const refuse = () => Promise.reject(new Error("the reader runs reads only"));
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
  });
  const config: ProcessConfig = {
    processName: "api-role-reader-only-test",
    encryptionKey: "0".repeat(64),
    secrets: {},
    rateLimit: { requests: 60, seconds: 60 },
    clickhouse: { readerUrl: "http://reader.invalid:8123" },
    eventing,
  };
  const stores = buildProcessStores({
    config,
    members: { clickhouse, prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }) },
  });
  return { stores, skipped, sent };
}

describe("given a role's stores over the reader credential alone", () => {
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
});
