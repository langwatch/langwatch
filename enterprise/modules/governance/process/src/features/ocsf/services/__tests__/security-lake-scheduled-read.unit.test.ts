// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A Security Lake source rides the ingestion pull lifecycle: its schedule becomes the pull's cron,
 * and each scheduled run of the pull worker reads its subscriber queue once through the Security
 * Lake puller. Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import {
  type GovernanceIngestionSource,
  SECURITY_LAKE_ADAPTER_ID,
  SECURITY_LAKE_SOURCE_TYPE,
} from "@langwatch/enterprise-governance-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { createWorkerService } from "../../../../__tests__/support/puller-test-ports.ts";
import { MemoryObjectStoreChannel } from "../../../../channels/memory/memory.object-store.channel.ts";
import { MemorySecurityLakeQueueChannel } from "../../../../channels/memory/memory.security-lake-queue.channel.ts";
import type { SecurityLakeQueue } from "../../../../channels/security-lake-queue.channel.ts";
import { IngestionPullLifecycleRepository } from "../../../../repositories/ingestion-pull-lifecycle.repository.ts";
import { MemoryOcsfEventsRepository } from "../../../../repositories/memory/memory.ocsf-events.repository.ts";
import { toPullLifecycleSource } from "../../../ingestion-pull/rules/pull-schedule.rules.ts";
import { IngestionPullLifecycleService } from "../../../ingestion-pull/services/ingestion-pull-lifecycle.service.ts";
import { SECURITY_LAKE_EXTERNAL_ID_KEY } from "../../rules/security-lake-credentials.rules.ts";
import { SecurityLakePullerService } from "../security-lake-puller.service.ts";
import { SecurityLakeReaderService } from "../security-lake-reader.service.ts";

const QUEUE_URL = "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-subscriber";

const SOURCE: GovernanceIngestionSource = {
  id: "src_lake",
  organizationId: "org_acme",
  teamId: null,
  sourceType: SECURITY_LAKE_SOURCE_TYPE,
  name: "ACME lake",
  description: null,
  ingestSecretHash: "",
  parserConfig: {
    adapter: SECURITY_LAKE_ADAPTER_ID,
    region: "eu-west-1",
    subscriberRoleArn: "arn:aws:iam::123456789012:role/AmazonSecurityLake-subscriber",
    queueUrl: QUEUE_URL,
    schedule: "*/5 * * * *",
    credentials: {
      aws_access_key_id: "AKIAACME",
      aws_secret_access_key: "secret",
      [SECURITY_LAKE_EXTERNAL_ID_KEY]: "generated-external-id",
    },
  },
  pollerCursor: null,
  errorCount: 0,
  pullSchedule: "*/5 * * * *",
  status: "active",
  lastEventAt: null,
  archivedAt: null,
  createdAt: new Date(1_763_300_000_000),
  updatedAt: new Date(1_763_300_000_000),
  createdById: "user_1",
};

class NoReconciliation extends IngestionPullLifecycleRepository {
  async findForReconciliation() {
    return [];
  }
}

function securityLakePuller() {
  const memory = MemorySecurityLakeQueueChannel.create();
  const receivedFrom: string[] = [];
  const queue: SecurityLakeQueue = {
    receive: async (input) => {
      receivedFrom.push(input.queueUrl);
      return memory.receive(input);
    },
    delete: (input) => memory.delete(input),
    changeVisibility: (input) => memory.changeVisibility(input),
    probe: () => memory.probe(),
  };
  const puller = SecurityLakePullerService.create({
    reader: SecurityLakeReaderService.create({
      queue,
      objects: MemoryObjectStoreChannel.create(),
      events: MemoryOcsfEventsRepository.create(),
    }),
    projects: createApiFixture({ ensureInternal: async () => ({ id: "project_governance" }) }),
  });
  return { puller, receivedFrom };
}

describe("Security Lake source on its pull schedule", () => {
  describe("given a Security Lake source with the schedule */5 * * * *", () => {
    /** @scenario "The source is read on its pull schedule" */
    it("schedules the pull on that cron and each run reads the subscriber queue once", async () => {
      const commands = { configure: vi.fn(async () => undefined), disable: vi.fn() };
      const lifecycle = IngestionPullLifecycleService.create({
        repository: new NoReconciliation(),
        projects: createApiFixture<ProjectApi>({ findInternalIds: async () => [] }),
        tenant: { resolveTenantId: async () => "project_governance" },
        commands,
      });
      await lifecycle.sync(toPullLifecycleSource(SOURCE));

      expect(commands.configure).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: SOURCE.id, cron: "*/5 * * * *" }),
      );
      expect(commands.disable).not.toHaveBeenCalled();

      const { puller, receivedFrom } = securityLakePuller();
      const worker = createWorkerService({
        source: SOURCE,
        adapter: puller,
        insertEvent: async () => undefined,
        usageEnabled: async () => false,
        ensureProject: async () => ({ id: "project_governance" }),
      });
      await worker.run({ sourceId: SOURCE.id, cursor: null });

      expect(receivedFrom).toEqual([QUEUE_URL]);
    });
  });
});
