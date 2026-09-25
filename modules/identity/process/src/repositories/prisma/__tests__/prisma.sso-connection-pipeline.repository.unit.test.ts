/**
 * The connection write surface the adapter hands back beside the pipeline
 * definition, so the back office can act without rebuilding the guards,
 * break-glass binding and ledger writer as a second composition.
 * @see ../prisma.sso-connection-pipeline.repository.ts
 */
import { ScimSsoMigrationSubscriberService } from "@langwatch/enterprise-scim-contract";
import { EventSourcing } from "@langwatch/eventing";
import {
  MIGRATION_FINALIZED_EVENT_TYPE,
  SSO_CONNECTION_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import type { PlatformOperator } from "../../../app/identity.members.ts";
import { migrationFinalizedEventSchema } from "../../../eventing/sso-connection-state.projection.ts";
import {
  PostgresSsoConnectionPipelineAdapter,
  type SsoConnectionPipelineDatabase,
} from "../prisma.sso-connection-pipeline.repository.ts";

/** The models the connection graph reads, none of them touched at composition time. */
function testDatabase(): SsoConnectionPipelineDatabase {
  const model = { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() };
  return prismaDouble({
    ssoConnection: model,
    user: model,
    organization: model,
  });
}

/** A runtime with the stack switched off: nothing here commits. */
function testEventSourcing(): EventSourcing {
  return new EventSourcing({ enabled: false });
}

class TestOperators implements PlatformOperator {
  isPlatformOperatorEmail(): boolean {
    return true;
  }
}

class TestDirectorySync extends ScimSsoMigrationSubscriberService {
  readonly moved: { connectionId: string; tenantId: string }[] = [];

  handleMigrationFinalized(
    event: { data: { connectionId: string } },
    context: { tenantId: string },
  ): Promise<void> {
    this.moved.push({ connectionId: event.data.connectionId, tenantId: context.tenantId });
    return Promise.resolve();
  }
}

const migrationFinalized = migrationFinalizedEventSchema.parse({
  id: "evt_1",
  aggregateId: "conn_new",
  aggregateType: SSO_CONNECTION_AGGREGATE_TYPE,
  tenantId: "org_1",
  createdAt: 1,
  occurredAt: 1,
  type: MIGRATION_FINALIZED_EVENT_TYPE,
  version: "2026-09-23",
  data: {
    connectionId: "conn_new",
    actor: { type: "user", id: "user_1" },
    source: "self-serve",
  },
});

function testAdapter(
  directorySync: TestDirectorySync = new TestDirectorySync(),
): PostgresSsoConnectionPipelineAdapter {
  return PostgresSsoConnectionPipelineAdapter.create({
    database: testDatabase(),
    eventSourcing: testEventSourcing(),
    operators: new TestOperators(),
    directorySync,
  });
}

describe("PostgresSsoConnectionPipelineAdapter", () => {
  describe("when a process asks for the connection write surface", () => {
    /** @scenario "The back office commands through the pipeline's own connection service" */
    it("hands back the same service every time, and the same one after the pipeline is built", () => {
      const adapter = testAdapter();

      const first = adapter.connections();
      expect(adapter.connections()).toBe(first);

      adapter.build();
      expect(adapter.connections()).toBe(first);
    });

    it("hands back that service when the pipeline was built first", () => {
      const adapter = testAdapter();

      adapter.build();
      expect(adapter.connections()).toBe(adapter.connections());
    });

    it("exposes the connection verbs the operator back office commands through", () => {
      const connections = testAdapter().connections();

      expect(connections.registerConnection).toBeTypeOf("function");
      expect(connections.claimDomain).toBeTypeOf("function");
      expect(connections.requestTeardown).toBeTypeOf("function");
    });
  });

  describe("when a move to the organization's own identity provider finishes", () => {
    it("declares directory sync as a subscriber to the finished migration only", () => {
      const subscriber = testAdapter().build().eventSubscribers.get("scimDirectoryMove");

      expect(subscriber?.eventTypes).toEqual([MIGRATION_FINALIZED_EVENT_TYPE]);
    });

    it("hands directory sync the replacement connection and the organization", async () => {
      const directorySync = new TestDirectorySync();
      const subscriber = testAdapter(directorySync)
        .build()
        .eventSubscribers.get("scimDirectoryMove");

      await subscriber?.handle(migrationFinalized, { tenantId: "org_1", aggregateId: "conn_new" });

      expect(directorySync.moved).toEqual([{ connectionId: "conn_new", tenantId: "org_1" }]);
    });
  });
});
