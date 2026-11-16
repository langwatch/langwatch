// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The AgentStop projection in Postgres.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { afterAll, describe, expect, it } from "vitest";

import { requestedStop } from "../../../features/kill-switch/rules/agent-stop.rules.ts";
import { PrismaAgentStopRepository } from "../prisma.agent-stop.repository.ts";
import { connection, killSwitchDatabase } from "./prisma.kill-switch.fixtures.ts";

describe.skipIf(!connection)("the AgentStop Prisma repository", () => {
  const { ns, newOrganization, prisma, cleanup } = killSwitchDatabase();

  afterAll(cleanup);

  describe("when the AgentStop projection stores a stop", () => {
    it("reads it back by id, agent and status, and only inside its organisation", async () => {
      const organizationId = newOrganization();
      const repository = PrismaAgentStopRepository.create(prisma());
      const stop = requestedStop({
        data: {
          stopId: `agentstop-${ns}`,
          organizationId,
          agentId: "agent-support-bot",
          agentName: "support-bot",
          severity: "high",
          approval: "required",
          trigger: "api_key",
          reason: "cost spike",
          requestedByUserId: "user-owner",
          requestedByApiKeyId: "key-trace-rule",
          targets: [
            {
              id: "target-vk",
              label: "Virtual key vk-support-bot",
              target: { kind: "gateway_virtual_key", virtualKeyId: "vk-support-bot" },
            },
          ],
        },
        at: Date.parse("2026-11-16T10:00:00Z"),
      });
      const at = Date.parse("2026-11-16T10:00:00Z");

      await repository.store(
        {
          state: stop,
          cursor: { acceptedAt: at, eventId: "event-1" },
          occurredAt: at,
          createdAt: at,
          updatedAt: at,
          version: "2026-11-16",
        },
        { tenantId: createTenantId(organizationId), aggregateId: stop.id },
      );

      expect(await repository.getStop({ organizationId, stopId: stop.id })).toEqual(stop);
      expect(
        (
          await repository.findByStatuses({ organizationId, statuses: [stop.status], limit: 10 })
        ).map((each) => each.id),
      ).toEqual([stop.id]);
      expect(
        await repository.findByAgent({ organizationId, agentId: "agent-support-bot", limit: 10 }),
      ).toHaveLength(1);
      await expect(
        repository.getStop({ organizationId: newOrganization(), stopId: stop.id }),
      ).rejects.toMatchObject({ code: "agent_stop_not_found" });
    });
  });
});
