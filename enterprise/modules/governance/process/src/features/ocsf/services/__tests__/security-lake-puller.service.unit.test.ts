// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { securityLakePullConfigSchema } from "@langwatch/enterprise-governance-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryObjectStoreChannel } from "../../../../channels/memory/memory.object-store.channel.ts";
import { MemorySecurityLakeQueueChannel } from "../../../../channels/memory/memory.security-lake-queue.channel.ts";
import type { GovernanceObjectStorageCredentials } from "../../../../channels/object-store.channel.ts";
import type { SecurityLakeQueue } from "../../../../channels/security-lake-queue.channel.ts";
import { MemoryOcsfEventsRepository } from "../../../../repositories/memory/memory.ocsf-events.repository.ts";
import {
  type InternalTenants,
  SecurityLakePullerService,
} from "../security-lake-puller.service.ts";
import { SecurityLakeReaderService } from "../security-lake-reader.service.ts";

const ROLE = "arn:aws:iam::123456789012:role/AmazonSecurityLake-subscriber";

function run(
  overrides: Record<string, unknown> = {},
  { externalId = "acme-external-id" }: { externalId?: string | null } = {},
) {
  const memory = MemorySecurityLakeQueueChannel.create();
  const seen: GovernanceObjectStorageCredentials[] = [];
  const queue: SecurityLakeQueue = {
    receive: async (input) => {
      seen.push(input.credentials);
      return memory.receive(input);
    },
    delete: (input) => memory.delete(input),
    changeVisibility: (input) => memory.changeVisibility(input),
    probe: () => memory.probe(),
  };
  const reader = SecurityLakeReaderService.create({
    queue,
    objects: MemoryObjectStoreChannel.create(),
    events: MemoryOcsfEventsRepository.create(),
  });
  const puller = SecurityLakePullerService.create({
    reader,
    projects: createApiFixture<InternalTenants>({
      ensureInternal: async () => ({ id: "project_governance" }),
    }),
    now: () => 1_763_300_000_000,
  });
  const config = securityLakePullConfigSchema.parse({
    adapter: "aws_security_lake",
    region: "eu-west-1",
    subscriberRoleArn: ROLE,
    queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-subscriber",
    ...overrides,
  });
  return puller
    .runOnce(
      {
        context: { organizationId: "org_acme", ingestionSourceId: "src_1" },
        credentials: {
          aws_access_key_id: "AKIAACME",
          aws_secret_access_key: "secret",
          ...(externalId === null ? {} : { external_id: externalId }),
        },
        cursor: null,
      } as never,
      config,
    )
    .then(() => seen);
}

describe("SecurityLakePullerService", () => {
  describe("given a source on AWS", () => {
    it("reads the queue as the subscriber role, assumed with the external id", async () => {
      const seen = await run();

      expect(seen[0]).toMatchObject({
        accessKeyId: "AKIAACME",
        assumeRole: { roleArn: ROLE, externalId: "acme-external-id" },
      });
    });
  });

  describe("given a source on AWS with no generated external id", () => {
    /** @scenario The reader refuses to assume the role without the generated external id */
    it("refuses before reading, so the role is never assumed without one", async () => {
      await expect(run({}, { externalId: null })).rejects.toThrow(/no external id/);
    });
  });

  describe("given an external id sent in the pull config", () => {
    it("assumes the role with the sealed one only", async () => {
      const seen = await run({ externalId: "attacker-chosen" });

      expect(seen[0]?.assumeRole).toEqual({ roleArn: ROLE, externalId: "acme-external-id" });
    });
  });

  describe("given a source on a local S3 and SQS emulator", () => {
    it("signs with the stored keys directly", async () => {
      const seen = await run({ sqsEndpoint: "http://localhost:4566" });

      expect(seen[0]?.assumeRole).toBeUndefined();
    });
  });

  describe("given a source on an AWS VPC endpoint for SQS", () => {
    it("still reads the queue as the subscriber role", async () => {
      const seen = await run({
        sqsEndpoint: "https://vpce-0abc.sqs.eu-west-1.vpce.amazonaws.com",
      });

      expect(seen[0]?.assumeRole).toEqual({ roleArn: ROLE, externalId: "acme-external-id" });
    });
  });
});
