// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: enterprise/modules/governance/specs/ocsf-siem.feature
 */
import { ADMIN_WORKSPACE_VIEW_ACTION } from "@langwatch/enterprise-governance-contract";
import type { IntentContext } from "@langwatch/eventing";
import { PrismaProcessStore } from "@langwatch/eventing/server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { WebhookApi, WebhookEndpointView } from "@langwatch/webhook-contract";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it, vi } from "vitest";

import { createGovernanceTestConnection } from "../../../../app/__tests__/governance-database.fixture.ts";
import type { GovernanceOcsfEvent } from "../../../../repositories/governance.repositories.ts";
import { MemoryOcsfEventsRepository } from "../../../../repositories/memory/memory.ocsf-events.repository.ts";
import { PrismaOcsfPushIntentStore } from "../../../../repositories/prisma/prisma.ocsf-push-intent.store.ts";
import {
  OutboxOcsfPushDelivery,
  requestOcsfPushDelivery,
} from "../../eventing/ocsf-push-delivery.intent.ts";
import {
  OCSF_PUSH_PROCESS_KEY,
  OCSF_PUSH_PROCESS_NAME,
  type OcsfPushIntent,
} from "../../eventing/ocsf-push-delivery.process.ts";
import { OcsfSiemPushService } from "../ocsf-siem-push.service.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl ? createGovernanceTestConnection(databaseUrl) : null;
const prisma = connection?.client as PrismaClient;

const suffix = nanoid(8);
const ORG = `org-ocsf-api-${suffix}`;
const TENANT = `gov-ocsf-api-${suffix}`;
const created = new Date("2026-11-01T00:00:00Z");

const endpoint: WebhookEndpointView = {
  id: `endpoint-${suffix}`,
  organizationId: ORG,
  destinationKind: "http",
  url: "https://siem.acme.test/ocsf",
  sqs: null,
  enabledEvents: ["ocsf.event"],
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

const workspaceView: GovernanceOcsfEvent = {
  tenantId: TENANT,
  eventId: `workspace-view-${suffix}`,
  traceId: `workspace-view-${suffix}`,
  sourceId: "langwatch",
  sourceType: "langwatch_admin",
  activityId: 2,
  severityId: 1,
  eventTime: Temporal.Instant.from("2026-11-17T09:00:00Z"),
  actorUserId: "admin-1",
  actorEmail: "admin@acme.test",
  actorEnduserId: "",
  actionName: ADMIN_WORKSPACE_VIEW_ACTION,
  targetName: "team-1",
  anomalyAlertId: "",
  rawOcsfJson: "{}",
};

describe.skipIf(!databaseUrl)("OCSF push from the api, which runs no pipeline", () => {
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  describe("given an active endpoint subscribed to ocsf.event", () => {
    /** @scenario "An event the api writes reaches a subscribed endpoint once" */
    it("queues one Postgres intent that the worker's handler turns into one delivery", async () => {
      const push = OcsfSiemPushService.create({
        events: MemoryOcsfEventsRepository.create(),
        projects: createApiFixture<ProjectApi>({ getOrganizationId: async () => ORG }),
        webhooks: createApiFixture<WebhookApi>({ getAll: async () => [endpoint] }),
        entitlements: { hasEnterprisePlan: async () => true },
        outbox: () => OutboxOcsfPushDelivery.create(PrismaOcsfPushIntentStore.create(prisma)),
      });

      await push.insertEvent(workspaceView);
      await push.insertEvent(workspaceView);

      const queued = await PrismaProcessStore.create({ database: prisma }).findMessagesByRef({
        ref: {
          processName: OCSF_PUSH_PROCESS_NAME,
          projectId: ORG,
          processKey: OCSF_PUSH_PROCESS_KEY,
        },
      });
      expect(queued).toHaveLength(1);

      const requestDelivery = vi.fn<WebhookApi["requestDelivery"]>();
      const handler = requestOcsfPushDelivery({ requestDelivery });
      const context: Partial<IntentContext> = {};
      for (const message of queued) {
        await handler(message.payload as OcsfPushIntent, context as IntentContext);
      }

      expect(requestDelivery).toHaveBeenCalledTimes(1);
      expect(requestDelivery.mock.calls[0]?.[0]).toMatchObject({
        organizationId: ORG,
        destinationId: endpoint.id,
        message: { type: "ocsf.event" },
      });
    });
  });
});
