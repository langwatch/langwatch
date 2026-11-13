/** Spec: modules/staff-access/specs/staff-access-use.feature */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { describe, expect, it } from "vitest";

import { ApiDoorAuditService } from "../api-door-audit.service.ts";

type Recorded = Parameters<AuditLogApi["record"]>[0];

function sinkRecording() {
  const recorded: Recorded[] = [];
  const service = ApiDoorAuditService.create({
    authz: {
      getScope: async () => {
        throw new Error("no scope lookup expected");
      },
    },
    auditLog: {
      record: async (row) => {
        recorded.push(row);
        return { id: `audit-${recorded.length}`, occurredAt: 0 };
      },
    },
  });
  return { sink: service.restAudit(), recorded };
}

describe("ApiDoorAuditService.restAudit", () => {
  describe("given a change made with a staff key", () => {
    it("names the staff principal and reason, with the approving operator as the actor", async () => {
      const { sink, recorded } = sinkRecording();

      await sink.record({
        actorId: null,
        action: "monitors.create",
        scope: { tier: "organization", id: "org-acme" },
        params: {},
        resultId: "monitor-1",
        apiKeyId: "staff-key",
        staffAccess: {
          principal: "LangWatch Support",
          approverUserId: "operator-1",
          reason: "ACME asked",
        },
      });

      expect(recorded).toEqual([
        expect.objectContaining({
          organizationId: "org-acme",
          actorUserId: "operator-1",
          metadata: {
            channel: "api",
            staffPrincipal: "LangWatch Support",
            staffReason: "ACME asked",
          },
        }),
      ]);
    });
  });

  describe("given an ordinary key", () => {
    it("names no staff principal and no acting operator", async () => {
      const { sink, recorded } = sinkRecording();

      await sink.record({
        actorId: null,
        action: "monitors.create",
        scope: { tier: "organization", id: "org-acme" },
        params: {},
        resultId: "monitor-1",
        apiKeyId: "customer-key",
      });

      expect(recorded[0]?.metadata).toEqual({ channel: "api" });
      expect(recorded[0]).not.toHaveProperty("actorUserId");
    });
  });
});
