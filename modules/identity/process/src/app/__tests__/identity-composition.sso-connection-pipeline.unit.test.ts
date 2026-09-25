/**
 * The connection write surface the adapter hands back beside the pipeline
 * definition, so the back office can act without rebuilding the guards,
 * break-glass binding and ledger writer as a second composition.
 * @see ../../eventing/sso-connection.pipeline.ts
 */
import { ScimSsoMigrationSubscriberService } from "@langwatch/enterprise-scim-contract";
import { EventSourcing } from "@langwatch/eventing";
import {
  MIGRATION_FINALIZED_EVENT_TYPE,
  SSO_CONNECTION_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { liveRepositories } from "../../__tests__/support/live-repositories.ts";
import { migrationFinalizedEventSchema } from "../../eventing/sso-connection-state.projection.ts";
import {
  composeSsoConnectionGraph,
  type SsoConnectionGraph,
} from "../../eventing/sso-connection.pipeline.ts";

/** The models the connection graph reads, none of them touched at composition time. */
function testDatabase(): PrismaClient {
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

function testGraph(directorySync: TestDirectorySync = new TestDirectorySync()): SsoConnectionGraph {
  return composeSsoConnectionGraph({
    repositories: liveRepositories(testDatabase()),
    eventSourcing: testEventSourcing(),
    directorySync,
  });
}

describe("composeSsoConnectionGraph", () => {
  describe("when a process asks for the connection write surface", () => {
    /** @scenario "The back office commands through the pipeline's own connection service" */
    it("composes the service and the pipeline from one graph", () => {
      const graph = testGraph();

      expect(graph.connections.registerConnection).toBeTypeOf("function");
      expect(graph.pipeline.eventSubscribers.get("scimDirectoryMove")).toBeDefined();
    });

    it("exposes the connection verbs the operator back office commands through", () => {
      const connections = testGraph().connections;

      expect(connections.registerConnection).toBeTypeOf("function");
      expect(connections.claimDomain).toBeTypeOf("function");
      expect(connections.requestTeardown).toBeTypeOf("function");
    });
  });

  describe("when a move to the organization's own identity provider finishes", () => {
    it("declares directory sync as a subscriber to the finished migration only", () => {
      const subscriber = testGraph().pipeline.eventSubscribers.get("scimDirectoryMove");

      expect(subscriber?.eventTypes).toEqual([MIGRATION_FINALIZED_EVENT_TYPE]);
    });

    it("hands directory sync the replacement connection and the organization", async () => {
      const directorySync = new TestDirectorySync();
      const subscriber =
        testGraph(directorySync).pipeline.eventSubscribers.get("scimDirectoryMove");

      await subscriber?.handle(migrationFinalized, { tenantId: "org_1", aggregateId: "conn_new" });

      expect(directorySync.moved).toEqual([{ connectionId: "conn_new", tenantId: "org_1" }]);
    });
  });
});
