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

  describe("when more stops match than one page holds", () => {
    /** @scenario "Every agent of the Agents page gets its kill switch summary, however many there are" */
    it("reads every one of them, latest first, a page at a time", async () => {
      const organizationId = newOrganization();
      const repository = PrismaAgentStopRepository.create(prisma());
      const requested = ["10:00:00", "10:00:00", "10:05:00", "10:10:00", "10:15:00"].map(
        (time, index) =>
          requestedStop({
            data: {
              stopId: `agentstop-${ns}-${index}`,
              organizationId,
              agentId: `agent-${index}`,
              agentName: `bot-${index}`,
              severity: "high",
              approval: "required",
              trigger: "api_key",
              reason: "cost spike",
              requestedByUserId: null,
              requestedByApiKeyId: "key-trace-rule",
              targets: [],
            },
            at: Date.parse(`2026-11-16T${time}Z`),
          }),
      );
      for (const stop of requested) {
        const at = Date.parse(stop.requestedAt);
        await repository.store(
          {
            state: stop,
            cursor: { acceptedAt: at, eventId: `event-${stop.id}` },
            occurredAt: at,
            createdAt: at,
            updatedAt: at,
            version: "2026-11-16",
          },
          { tenantId: createTenantId(organizationId), aggregateId: stop.id },
        );
      }

      const all = await repository.findAllByStatuses({
        organizationId,
        statuses: ["pending_approval"],
        pageSize: 2,
      });

      expect(all.map((stop) => stop.id)).toEqual([
        `agentstop-${ns}-4`,
        `agentstop-${ns}-3`,
        `agentstop-${ns}-2`,
        `agentstop-${ns}-1`,
        `agentstop-${ns}-0`,
      ]);
    });
  });

  describe("when a requested stop is seeded before the projection folds it", () => {
    /** @scenario "A new stop reads back as soon as its 202 returns" */
    it("reads the seed back, lets the projection fold onto it and never overwrites a folded row", async () => {
      const organizationId = newOrganization();
      const repository = PrismaAgentStopRepository.create(prisma());
      const at = Date.parse("2026-11-17T10:00:00Z");
      const stop = requestedStop({
        data: {
          stopId: `agentstop-${ns}-seed`,
          organizationId,
          agentId: "agent-support-bot",
          agentName: "support-bot",
          severity: "high",
          approval: "required",
          trigger: "api_key",
          reason: "cost spike",
          requestedByUserId: null,
          requestedByApiKeyId: "key-trace-rule",
          targets: [],
        },
        at,
      });
      const context = { tenantId: createTenantId(organizationId), aggregateId: stop.id };

      await repository.seed({ stop, at });
      expect(await repository.getStop({ organizationId, stopId: stop.id })).toEqual(stop);
      const read = await repository.get(stop.id, context);
      expect(read.kind === "folded" ? read.projection.cursor : null).toEqual({
        acceptedAt: 0,
        eventId: "",
      });

      const approved = { ...stop, status: "stopping" as const, retryRound: 2 };
      await repository.store(
        {
          state: approved,
          cursor: { acceptedAt: at + 1, eventId: "event-approved" },
          occurredAt: at + 1,
          createdAt: at,
          updatedAt: at + 1,
          version: "2026-11-16",
        },
        context,
      );
      await repository.seed({ stop, at });

      expect(await repository.getStop({ organizationId, stopId: stop.id })).toEqual(approved);
    });
  });

  describe("when the targets column is read back", () => {
    /** @scenario "A stop row whose targets column does not match its schema is refused" */
    it("round-trips both rounds and refuses a round that is not a number", async () => {
      const organizationId = newOrganization();
      const repository = PrismaAgentStopRepository.create(prisma());
      const at = Date.parse("2026-11-16T10:00:00Z");
      const stop = {
        ...requestedStop({
          data: {
            stopId: `agentstop-${ns}-rounds`,
            organizationId,
            agentId: "agent-support-bot",
            agentName: "support-bot",
            severity: "critical",
            approval: "immediate",
            trigger: "user",
            reason: "cost spike",
            requestedByUserId: "user-ops",
            requestedByApiKeyId: null,
            targets: [
              {
                id: "target-vk",
                label: "Virtual key vk-support-bot",
                target: { kind: "gateway_virtual_key", virtualKeyId: "vk-support-bot" },
              },
            ],
          },
          at,
        }),
        restoreRound: 2,
        retryRound: 1,
        retriedByUserId: "user-ops",
        retriedByApiKeyId: null,
        advancedRequestIds: ["retry-1"],
      };
      await repository.store(
        {
          state: stop,
          cursor: { acceptedAt: at, eventId: "event-rounds" },
          occurredAt: at,
          createdAt: at,
          updatedAt: at,
          version: "2026-11-16",
        },
        { tenantId: createTenantId(organizationId), aggregateId: stop.id },
      );

      expect(await repository.getStop({ organizationId, stopId: stop.id })).toEqual(stop);

      const row = await prisma().agentStop.findFirstOrThrow({
        where: { organizationId, id: stop.id },
      });
      await prisma().agentStop.updateMany({
        where: { organizationId, id: stop.id },
        data: { targets: { ...(row.targets as object), restoreRound: "2" } },
      });
      await expect(repository.getStop({ organizationId, stopId: stop.id })).rejects.toMatchObject({
        name: "ZodError",
      });
    });
  });
});
