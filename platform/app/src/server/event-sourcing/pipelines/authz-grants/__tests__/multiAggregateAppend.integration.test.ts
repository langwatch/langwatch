/**
 * specs/event-sourcing/multi-aggregate-pipeline.feature — the authorization
 * pipeline appends a role and a grant under their own aggregate types
 * (ADR-113). This is the failure #7406 papered over: the real pipeline
 * definition, registered on the runtime with a ClickHouse event log.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTestClickHouseClient } from "../../../__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  getTenantIdString,
} from "../../../__tests__/integration/testHelpers";
import { EventSourcing } from "../../../eventSourcing";
import { createTestTenantId } from "../../../services/__tests__/testHelpers";
import { EventStoreClickHouse } from "../../../stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../../../stores/repositories/eventRepositoryClickHouse";
import { createAuthzGrantsPipeline } from "../pipeline";
import {
  AUTHZ_GRANT_AGGREGATE_TYPE,
  AUTHZ_ROLE_AGGREGATE_TYPE,
} from "../schemas/constants";

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

const ACTOR = { type: "user", id: "user_admin" } as const;
const AT = 1_755_000_000_000;

describe.skipIf(!hasTestcontainers)(
  "given the authorization pipeline declaring authz_grant and authz_role",
  () => {
    let eventSourcing: EventSourcing;
    let eventStore: EventStoreClickHouse;
    let tenantIdString: string;

    beforeEach(async () => {
      const clickHouseClient = getTestClickHouseClient();
      if (!clickHouseClient) throw new Error("ClickHouse required.");
      eventStore = new EventStoreClickHouse(
        new EventRepositoryClickHouse(async () => clickHouseClient),
      );
      eventSourcing = EventSourcing.createWithStores({
        eventStore,
        clickhouse: async () => clickHouseClient,
      });
      tenantIdString = getTenantIdString(createTestTenantId());
    });

    afterEach(async () => {
      await eventSourcing.close();
      await cleanupTestDataForTenant(tenantIdString);
    });

    /** @scenario "The authorization pipeline appends a role and a grant under their own types" */
    it("stores the role row as authz_role and the grant row as authz_grant", async () => {
      const pipeline = eventSourcing.register(
        createAuthzGrantsPipeline({
          authzGrantsWriteStore: { append: async () => {} } as never,
          authzAuditTrailStore: { insert: async () => {} },
        }),
      );
      await pipeline.service.waitUntilReady();
      const identity = {
        tenantId: tenantIdString,
        organizationId: tenantIdString,
      };

      // Roles are stated before grants — the order the migration uses, and
      // the order that parked every organization at index 0 before ADR-113.
      await pipeline.commands.defineRole.send({
        ...identity,
        commandId: "cmd_role",
        role: {
          roleId: "role_1",
          name: "Auditor",
          permissions: ["traces:view"],
          kind: "custom",
          occurredAtMs: AT,
        },
        actor: ACTOR,
      });
      await pipeline.commands.attachGrant.send({
        ...identity,
        commandId: "cmd_grant",
        grant: {
          grantId: "grant_1",
          principal: { type: "user", id: "user_alice" },
          roleKey: "member",
          scope: { type: "TEAM", id: "team_1" },
          source: "grants-service",
          actor: ACTOR,
          occurredAtMs: AT,
        },
      });

      const context = { tenantId: createTestTenantId(tenantIdString) };
      const roleRows = await eventStore.getEvents(
        "role_1",
        context,
        AUTHZ_ROLE_AGGREGATE_TYPE,
      );
      const grantRows = await eventStore.getEvents(
        "grant_1",
        context,
        AUTHZ_GRANT_AGGREGATE_TYPE,
      );

      expect(roleRows.map((e) => e.aggregateType)).toEqual([
        AUTHZ_ROLE_AGGREGATE_TYPE,
      ]);
      expect(grantRows.map((e) => e.aggregateType)).toEqual([
        AUTHZ_GRANT_AGGREGATE_TYPE,
      ]);
    });
  },
);
