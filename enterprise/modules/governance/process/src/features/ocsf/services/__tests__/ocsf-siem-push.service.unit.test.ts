/** Spec: enterprise/modules/governance/specs/ocsf-siem.feature */
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { WebhookApi, WebhookEndpointView } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import type { GovernanceOcsfEvent } from "../../../../repositories/governance.repositories.ts";
import { MemoryOcsfEventsRepository } from "../../../../repositories/memory/memory.ocsf-events.repository.ts";
import {
  type OcsfPushIntent,
  ocsfPushDeliveryKey,
} from "../../eventing/ocsf-push-delivery.process.ts";
import { OcsfSiemPushService } from "../ocsf-siem-push.service.ts";

const ORG = "org-1";
const TENANT = "governance-project-1";

function event(id: string, sourceType = "otel_generic"): GovernanceOcsfEvent {
  return {
    tenantId: TENANT,
    eventId: id,
    traceId: id,
    sourceId: "src-1",
    sourceType,
    activityId: 6,
    severityId: 1,
    eventTime: Temporal.Instant.from("2026-11-10T12:00:00Z"),
    actorUserId: "user-1",
    actorEmail: "",
    actorEnduserId: "",
    actionName: "trace.recorded",
    targetName: "openai/gpt-5-mini",
    anomalyAlertId: "",
    rawOcsfJson: "{}",
  };
}

function endpoint(enabledEvents: string[]): WebhookEndpointView {
  const created = new Date("2026-11-01T00:00:00Z");
  return {
    id: "endpoint-1",
    organizationId: ORG,
    destinationKind: "http",
    url: "https://siem.acme.test/ocsf",
    sqs: null,
    enabledEvents,
    status: "ACTIVE",
    disabledReason: null,
    disabledAt: null,
    failingSince: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    maxBatchSize: 100,
    maxBatchDelayMs: 1000,
    maxInFlight: 1,
    allowSelfSignedCertificate: false,
    createdAt: created,
    updatedAt: created,
  };
}

function build({
  enabledEvents,
  enterprise = true,
}: {
  enabledEvents: string[];
  enterprise?: boolean;
}) {
  const recorded: OcsfPushIntent[] = [];
  const events = MemoryOcsfEventsRepository.create();
  const push = OcsfSiemPushService.create({
    events,
    projects: createApiFixture<ProjectApi>({ getOrganizationId: async () => ORG }),
    webhooks: createApiFixture<WebhookApi>({ getAll: async () => [endpoint(enabledEvents)] }),
    entitlements: { hasEnterprisePlan: async () => enterprise },
    outbox: () => ({
      record: async (intents) => {
        recorded.push(...intents);
      },
    }),
  });
  return { push, recorded, events };
}

describe("OcsfSiemPushService", () => {
  describe("given an endpoint subscribed to ocsf.event", () => {
    /** @scenario Each written OCSF event is queued for every subscribed endpoint */
    it("queues one delivery per written event, each an OCSF 1.9 event", async () => {
      const { push, recorded, events } = build({ enabledEvents: ["ocsf.event"] });

      await push.insertEvents([event("e-1"), event("e-2"), event("e-3")]);

      expect(recorded.map((intent) => intent.eventId)).toEqual(["e-1", "e-2", "e-3"]);
      expect(recorded[0]).toMatchObject({ organizationId: ORG, endpointId: "endpoint-1" });
      expect(recorded[0]!.body).toMatchObject({
        class_uid: 6003,
        metadata: { uid: "e-1", version: "1.9.0" },
      });
      expect(JSON.stringify(recorded[0]!.body)).toContain('"stored_ocsf_version":"1.1.0"');
      const stored = await events.findAll({
        tenantId: TENANT,
        sinceMs: 0,
        sinceEventId: "",
        limit: 10,
      });
      expect(stored).toHaveLength(3);
    });

    /** @scenario Events pushed in from another source are not pushed back out */
    it("does not queue events pushed in from another source", async () => {
      const { push, recorded } = build({ enabledEvents: ["ocsf.event"] });

      await push.insertEvents([event("okta-1", "ocsf_push")]);

      expect(recorded).toEqual([]);
    });
  });

  describe("given an endpoint subscribed to every event type", () => {
    /** @scenario An endpoint subscribed to every event type receives no OCSF events */
    it("queues nothing", async () => {
      const { push, recorded } = build({ enabledEvents: ["*", "governance.*"] });

      await push.insertEvents([event("e-1")]);

      expect(recorded).toEqual([]);
    });
  });

  describe("given an event written again beside a new one", () => {
    /** @scenario An event written again keeps its delivery key, so the endpoint receives it once */
    it("repeats the delivery key of the repeated event", async () => {
      const { push, recorded } = build({ enabledEvents: ["ocsf.*"] });

      await push.insertEvents([event("e-1")]);
      await push.insertEvents([event("e-1"), event("e-2")]);

      const keys = recorded.map((intent) => ocsfPushDeliveryKey(intent));
      expect(keys).toEqual(["ocsf:e-1:endpoint-1", "ocsf:e-1:endpoint-1", "ocsf:e-2:endpoint-1"]);
    });
  });

  describe("given an organisation off the Enterprise plan", () => {
    /** @scenario No event is queued for an organisation off the Enterprise plan */
    it("queues nothing", async () => {
      const { push, recorded } = build({ enabledEvents: ["ocsf.event"], enterprise: false });

      await push.insertEvents([event("e-1")]);

      expect(recorded).toEqual([]);
    });
  });
});
