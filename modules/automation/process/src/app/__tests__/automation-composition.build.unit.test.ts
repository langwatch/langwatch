import { buildGraphAlertTemplateContext } from "@langwatch/automation-contract";
import { ReactEmailMailRenderer } from "@langwatch/mail";
import { frozenAt, recordingMail } from "@langwatch/test-harness";
import { Temporal, toDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { GraphAlertDispatchInput } from "../../channels/automation-graph-alert.channel.ts";
import { settlementTrigger } from "../../fixtures/settlement.fixtures.ts";
import { MemoryAutomationRepositories } from "../../repositories/memory/memory.automation.repositories.ts";
import { AutomationNotificationDeliveryService } from "../../services/automation-notification-delivery.service.ts";
import { AutomationProviderRegistryService } from "../../services/automation-provider-registry.service.ts";
import { AutomationEmailCapService } from "../../services/email-cap.service.ts";
import { buildGraphAlertNotifier } from "../automation-composition.build.ts";

const BASE_HOST = "https://app.langwatch.test";
const SAVED_AT = toDate(Temporal.Instant.from("2026-06-01T00:00:00.000Z"));

function composeNotifier(publicBaseUrl: string | undefined) {
  const mail = recordingMail();
  const notifier = buildGraphAlertNotifier({
    members: { publicBaseUrl },
    repositories: MemoryAutomationRepositories.create(),
    caps: { emailHourlyCap: 10, tenantDailyCap: 100 },
    providers: AutomationProviderRegistryService.create({
      encrypt: (value) => value,
      decrypt: (value) => value,
    }),
    clock: frozenAt(),
    delivery: AutomationNotificationDeliveryService.create({
      mailer: mail,
      renderer: ReactEmailMailRenderer.create(),
      baseHost: BASE_HOST,
      unsubscribeSigningSecret: "0f".repeat(32),
    }),
    emailCaps: AutomationEmailCapService.create({ store: null }),
  });
  return { mail, notifier };
}

function crossedAlert(): GraphAlertDispatchInput {
  return {
    trigger: {
      ...settlementTrigger("SEND_EMAIL"),
      active: true,
      deleted: false,
      pausedReason: null,
      pausedAt: null,
      createdAt: SAVED_AT,
      updatedAt: SAVED_AT,
      lastRunAt: null,
    },
    project: { id: "project-1" },
    context: buildGraphAlertTemplateContext({
      trigger: { id: "trigger-1", name: "High latency", alertType: "WARNING" },
      graph: { id: "graph-1", name: "Latency p95" },
      metric: { label: "Latency p95", seriesName: "0/duration/p95" },
      condition: { operator: "gt", threshold: 500, timePeriodMinutes: 60 },
      currentValue: 712,
      occurredAt: Temporal.Instant.from("2026-06-21T10:00:00.000Z"),
      reason: "real-time",
      project: { id: "project-1", name: "Acme", slug: "acme" },
      baseHost: BASE_HOST,
    }),
    recipients: ["ada@example.com"],
    slackWebhook: null,
    fireDigest: "digest-1",
  };
}

describe("buildGraphAlertNotifier", () => {
  describe("given a process that names its public origin", () => {
    /** @scenario "With a public origin, a graph alert's email leaves through the process mail member" */
    it("sends the alert through the mail member", async () => {
      const { mail, notifier } = composeNotifier(BASE_HOST);

      await expect(notifier.dispatch(crossedAlert())).resolves.toMatchObject({
        channel: "email",
        didSend: true,
      });

      expect(mail.sent).toHaveLength(1);
      expect(JSON.stringify(mail.sent[0])).toContain("ada@example.com");
    });
  });

  describe("given a process that names no public origin", () => {
    /** @scenario "Without a public origin, graph alerts refuse by name" */
    it("refuses with the service-unavailable code", async () => {
      const { mail, notifier } = composeNotifier(undefined);

      await expect(notifier.dispatch(crossedAlert())).rejects.toMatchObject({
        code: "service_unavailable",
      });
      expect(mail.sent).toHaveLength(0);
    });
  });
});
