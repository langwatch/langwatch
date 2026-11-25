// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type GovernanceIngestionSource,
  securityLakeSourceUpdateInputSchema,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { MemoryObjectStoreChannel } from "../../../../channels/memory/memory.object-store.channel.ts";
import { MemorySecurityLakeQueueChannel } from "../../../../channels/memory/memory.security-lake-queue.channel.ts";
import type { SecurityLakeQueue } from "../../../../channels/security-lake-queue.channel.ts";
import { MemoryOcsfEventsRepository } from "../../../../repositories/memory/memory.ocsf-events.repository.ts";
import { ocsfEventToGovernanceRow } from "../../rules/ocsf-ingest-row.rules.ts";
import { SecurityLakePullerService } from "../security-lake-puller.service.ts";
import { SecurityLakeReaderService } from "../security-lake-reader.service.ts";
import { SecurityLakeSourceService } from "../security-lake-source.service.ts";

const ORG = "org_acme";
const CONFIG = {
  region: "eu-west-1",
  subscriberRoleArn: "arn:aws:iam::123456789012:role/AmazonSecurityLake-subscriber",
  queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-subscriber",
};
const KEYS = { aws_access_key_id: "AKIAACME", aws_secret_access_key: "secret" };

const GOVERNANCE_PROJECT = "project_governance";

function setup({ queue }: { queue?: SecurityLakeQueue } = {}) {
  const rows = new Map<string, GovernanceIngestionSource>();
  const events = MemoryOcsfEventsRepository.create();
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const memoryQueue = MemorySecurityLakeQueueChannel.create();
  const service = SecurityLakeSourceService.create({
    queue: queue ?? memoryQueue,
    events,
    projects: { findInternal: async () => ({ id: GOVERNANCE_PROJECT }) as never },
    pullRuns: { getLastPullOutcome: async () => ({ lastError: null }) },
    sources: {
      createSource: async (input) => {
        created.push(input);
        const at = new Date(1_763_300_000_000);
        const source: GovernanceIngestionSource = {
          id: `src_${rows.size + 1}`,
          organizationId: input.organizationId,
          teamId: null,
          sourceType: input.sourceType,
          name: input.name,
          description: null,
          ingestSecretHash: "",
          parserConfig: input.parserConfig,
          pollerCursor: null,
          errorCount: 0,
          pullSchedule: input.pullSchedule,
          status: "awaiting_first_event",
          lastEventAt: null,
          archivedAt: null,
          createdAt: at,
          updatedAt: at,
          createdById: input.actorUserId,
        };
        rows.set(source.id, source);
        return { source };
      },
      updateSource: async (input) => {
        updates.push(input);
        const row = rows.get(input.id);
        if (!row) throw new Error(`no source ${input.id}`);
        return row;
      },
      findById: async ({ id, organizationId }) => {
        const row = rows.get(id);
        return row?.organizationId === organizationId ? row : null;
      },
    },
  });
  const add = (schedule?: string) =>
    service.create({
      organizationId: ORG,
      actorUserId: "user_admin",
      name: "ACME lake",
      config: { ...CONFIG, ...(schedule ? { schedule } : {}) } as never,
      credentials: KEYS,
    });
  return { service, rows, created, updates, memoryQueue, events, add };
}

describe("SecurityLakeSourceService", () => {
  /** @scenario Editing one Security Lake setting keeps the other stored settings */
  it("merges a queue-only update over the stored settings without schema defaults", async () => {
    const { add, service, updates } = setup();
    const source = await add("*/10 * * * *");
    const queueUrl = "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-other";
    const { config } = securityLakeSourceUpdateInputSchema.parse({ config: { queueUrl } });

    await service.update({ id: source.id, organizationId: ORG, config });

    expect(config).toEqual({ queueUrl });
    expect(updates[0]).not.toHaveProperty("pullSchedule");
    expect(updates[0]!.parserConfig).toMatchObject({ queueUrl, schedule: "*/10 * * * *" });
    expect(updates[0]!.parserConfig).not.toHaveProperty("credentials");
  });

  /** @scenario Saving a Security Lake source gives it the pull schedule from its configuration */
  it("stores a security_lake ingestion source with the configured pull schedule", async () => {
    const { add, created } = setup();
    const source = await add("*/10 * * * *");
    expect(source).toMatchObject({ schedule: "*/10 * * * *", region: "eu-west-1" });
    expect(created[0]).toMatchObject({
      sourceType: "security_lake",
      pullSchedule: "*/10 * * * *",
      parserConfig: { adapter: "aws_security_lake", credentials: expect.objectContaining(KEYS) },
    });
  });

  /** @scenario Test connection reads the queue backlog without taking a message */
  it("reports the queue backlog and leaves the messages on the queue", async () => {
    const { add, service, memoryQueue } = setup();
    const source = await add();
    memoryQueue.send({ body: "one" });
    memoryQueue.send({ body: "two" });
    const test = await service.testConnection({ organizationId: ORG, id: source.id });
    expect(test).toEqual({ ok: true, waiting: 2, inFlight: 0, error: null });
    expect(memoryQueue.deleted).toEqual([]);
  });

  /** @scenario Test connection reports the AWS error when the queue refuses */
  it("reports the queue unreachable with the AWS error code only", async () => {
    const refusing = MemorySecurityLakeQueueChannel.create();
    refusing.probe = async () => {
      throw Object.assign(
        new Error("User: arn:aws:sts::111122223333:assumed-role/worker/x is not authorized"),
        { name: "AccessDenied" },
      );
    };
    const { add, service } = setup({ queue: refusing });
    const source = await add();
    const test = await service.testConnection({ organizationId: ORG, id: source.id });
    expect(test).toMatchObject({
      ok: false,
      waiting: null,
      error: "The AWS request failed with AccessDenied.",
    });
  });

  it("refuses a source of another organisation as not found", async () => {
    const { add, service } = setup();
    const source = await add();
    await expect(
      service.health({ organizationId: "org_other", id: source.id }),
    ).rejects.toMatchObject({
      name: "IngestionSourceNotFoundError",
    });
  });

  /** @scenario The source health shows the last read, lag, counts and poison objects */
  it("shows the health the scheduled pull folded into the cursor", async () => {
    const { add, service, rows } = setup();
    const source = await add();
    const queue = MemorySecurityLakeQueueChannel.create();
    queue.send({ body: "not a notification" });
    const puller = SecurityLakePullerService.create({
      reader: SecurityLakeReaderService.create({
        queue,
        objects: MemoryObjectStoreChannel.create(),
        events: MemoryOcsfEventsRepository.create(),
      }),
      projects: { ensureInternal: async () => ({ id: "project_governance" }) },
      now: () => 1_763_300_000_000,
    });
    const stored = rows.get(source.id)!;
    const result = await puller.runOnce(
      {
        cursor: null,
        credentials: { ...KEYS, external_id: source.externalId },
        context: { organizationId: ORG, ingestionSourceId: source.id },
      },
      puller.validateConfig(stored.parserConfig),
    );
    expect(result).toMatchObject({
      events: [],
      writtenCount: 0,
      errorCount: 1,
      completeness: "complete",
    });
    rows.set(source.id, { ...stored, pollerCursor: result.cursor });

    const health = await service.health({ organizationId: ORG, id: source.id });
    expect(health.health).toMatchObject({
      lastReadAt: 1_763_300_000_000,
      runs: 1,
      messages: 1,
      written: 0,
      poisonCount: 1,
    });
    expect(health.health.poison[0]).toMatchObject({ at: 1_763_300_000_000 });
  });

  /** @scenario The written count counts each event once when a file is read again */
  it("counts an event written again once in the source health", async () => {
    const { add, service, events } = setup();
    const source = await add();
    const row = (eventId: string, sourceId = source.id) =>
      ocsfEventToGovernanceRow({
        tenantId: GOVERNANCE_PROJECT,
        sourceType: "security_lake",
        sourceId,
        event: {
          class_uid: 6003,
          severity_id: 1,
          time: 1_763_300_000_000,
          metadata: { uid: eventId, version: "1.1.0" },
        } as never,
      });
    await events.insertEvents([row("e1"), row("e2")]);
    await events.insertEvents([row("e1"), row("e3", "src_other")]);

    const health = await service.health({ organizationId: ORG, id: source.id });
    expect(health.health.written).toBe(2);
  });
  describe("given the external id LangWatch generates", () => {
    /** @scenario LangWatch generates the external id of a Security Lake source */
    it("generates a random external id, seals it with the keys and ignores a caller's", async () => {
      const { service, created } = setup();
      const first = await service.create({
        organizationId: ORG,
        actorUserId: "user_admin",
        name: "ACME lake",
        config: { ...CONFIG, externalId: "attacker-chosen" } as never,
        credentials: { ...KEYS, external_id: "attacker-chosen" } as never,
      });
      const { add } = setup();
      const second = await add();

      expect(first.externalId).toMatch(/^lw-[0-9a-f]{32}$/);
      expect(second.externalId).not.toBe(first.externalId);
      const parserConfig = created[0]!.parserConfig as Record<string, unknown>;
      expect(parserConfig).not.toHaveProperty("externalId");
      expect(parserConfig.credentials).toEqual({ ...KEYS, external_id: first.externalId });
    });

    it("keeps the external id when an update sends new keys or settings", async () => {
      const { add, service, updates } = setup();
      const source = await add();
      const keys = { aws_access_key_id: "AKIANEW", aws_secret_access_key: "new-secret" };

      const updated = await service.update({
        id: source.id,
        organizationId: ORG,
        config: { externalId: "attacker-chosen" } as never,
        credentials: keys,
      });

      expect(updated.externalId).toBe(source.externalId);
      expect(updates[0]!.parserConfig).toMatchObject({
        credentials: { ...keys, external_id: source.externalId },
      });
      expect(updates[0]!.parserConfig).not.toHaveProperty("externalId");
    });

    it("returns the external id on the dedicated read", async () => {
      const { add, service } = setup();
      const source = await add();

      await expect(service.get({ organizationId: ORG, id: source.id })).resolves.toMatchObject({
        id: source.id,
        externalId: source.externalId,
      });
    });
  });

  /** @scenario Test connection assumes the subscriber role with the external id */
  it("tests the connection as the subscriber role, assumed with the generated external id", async () => {
    const roles: unknown[] = [];
    const probe: SecurityLakeQueue["probe"] = async (input) => {
      roles.push(input.credentials.assumeRole);
      return { waiting: 0, inFlight: 0 };
    };
    const queue: SecurityLakeQueue = Object.assign(MemorySecurityLakeQueueChannel.create(), {
      probe,
    });
    const { add, service } = setup({ queue });
    const source = await add();

    await service.testConnection({ organizationId: ORG, id: source.id });

    expect(roles).toEqual([{ roleArn: CONFIG.subscriberRoleArn, externalId: source.externalId }]);
  });

  /** @scenario Test connection checks the settings in the form before they are saved */
  it("tests the queue and keys sent, over the stored settings, without saving them", async () => {
    const seen: { queueUrl: string; accessKeyId: string; externalId?: string }[] = [];
    const probe: SecurityLakeQueue["probe"] = async (input) => {
      seen.push({
        queueUrl: input.queueUrl,
        accessKeyId: input.credentials.accessKeyId ?? "",
        externalId: input.credentials.assumeRole?.externalId,
      });
      return { waiting: 0, inFlight: 0 };
    };
    const queue: SecurityLakeQueue = Object.assign(MemorySecurityLakeQueueChannel.create(), {
      probe,
    });
    const { add, service, updates } = setup({ queue });
    const source = await add();
    const queueUrl = "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-fixed";

    await service.testConnection({
      organizationId: ORG,
      id: source.id,
      config: { queueUrl },
      credentials: { aws_access_key_id: "AKIAFORM", aws_secret_access_key: "form-secret" },
    });
    await service.testConnection({ organizationId: ORG, id: source.id });

    expect(seen).toEqual([
      { queueUrl, accessKeyId: "AKIAFORM", externalId: source.externalId },
      {
        queueUrl: CONFIG.queueUrl,
        accessKeyId: KEYS.aws_access_key_id,
        externalId: source.externalId,
      },
    ]);
    expect(updates).toEqual([]);
  });
});
