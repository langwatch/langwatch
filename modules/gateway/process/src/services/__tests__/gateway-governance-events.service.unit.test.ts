import { createApiFixture } from "@langwatch/api-fixture";
import type { EventingCommandSender } from "@langwatch/eventing";
import type { ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { GatewayVirtualKeyLifecycleSignal } from "../../app/gateway.members.ts";
import { GatewayGovernanceEventsService } from "../gateway-governance-events.service.ts";

const NOW = Temporal.Instant.from("2026-09-29T10:00:00Z");

function recordingSender(refusal?: Error) {
  const sent: unknown[] = [];
  const sender: Pick<EventingCommandSender<unknown>, "send"> = {
    send: async (payload) => {
      if (refusal) throw refusal;
      sent.push(payload);
    },
  };
  return { sent, sender };
}

function harness({ refusal }: { refusal?: Error } = {}) {
  const projects = createApiFixture<ProjectApi>({
    listIdsByOrganization: async () => ["project-b", "project-a"],
  });
  const service = GatewayGovernanceEventsService.create({ projects, clock: () => NOW });
  const lifecycle = recordingSender(refusal);
  const crossing = recordingSender();
  return { service, lifecycle, crossing };
}

const signal = (traceProjectId: string | null): GatewayVirtualKeyLifecycleSignal => ({
  virtualKey: {
    id: "vk-1",
    organizationId: "org-1",
    name: "Production key",
    displayPrefix: "lw_vk_",
    traceProjectId,
  },
  action: "disabled",
  reason: "billing hold",
});

describe("GatewayGovernanceEventsService", () => {
  describe("when a key is disabled", () => {
    /** @scenario "A key lifecycle change is recorded by gateway for delivery" */
    it("records main's lifecycle fact under the key's trace project", async () => {
      const { service, lifecycle, crossing } = harness();
      service.connect({
        recordVkLifecycle: lifecycle.sender,
        recordBudgetCrossing: crossing.sender,
      });

      await service.emitVirtualKeyLifecycle(signal("project-trace"));

      expect(lifecycle.sent).toEqual([
        {
          tenantId: "project-trace",
          organization_id: "org-1",
          virtual_key_id: "vk-1",
          action: "disabled",
          name: "Production key",
          display_prefix: "lw_vk_",
          reason: "billing hold",
          occurred_at: NOW.epochMilliseconds,
        },
      ]);
    });

    it("falls back to one stable organization project when the key has no trace project", async () => {
      const { service, lifecycle, crossing } = harness();
      service.connect({
        recordVkLifecycle: lifecycle.sender,
        recordBudgetCrossing: crossing.sender,
      });

      await service.emitVirtualKeyLifecycle(signal(null));

      expect(lifecycle.sent).toMatchObject([{ tenantId: "project-a" }]);
    });
  });

  describe("when the lifecycle fact cannot be recorded", () => {
    it("never fails the key mutation that announced it", async () => {
      const { service, lifecycle, crossing } = harness({ refusal: new Error("queue down") });
      service.connect({
        recordVkLifecycle: lifecycle.sender,
        recordBudgetCrossing: crossing.sender,
      });

      await expect(
        service.emitVirtualKeyLifecycle(signal("project-trace")),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the governance pipeline is not registered in this process", () => {
    it("refuses a crossing, so the debit is re-driven rather than the crossing lost", async () => {
      const { service } = harness();

      await expect(
        service.recordBudgetCrossing({
          tenantId: "project-1",
          organization_id: "org-1",
          budget_id: "b",
          kind: "breached",
          scope_type: "project",
          bucket_scope_id: "project-1",
          end_user_id: null,
          virtual_key_id: null,
          anchor_project_id: "project-1",
          window: "MONTH",
          period_started_at_ms: 0,
          limit_usd: "1.000000",
          spent_usd: "2.000000",
          on_breach: "block",
          occurred_at: 1,
        }),
      ).rejects.toThrow("governance_events_processing");
    });
  });
});
