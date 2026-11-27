// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { securityLakePullConfigSchema } from "@langwatch/enterprise-governance-contract";
import { DispatchError } from "@langwatch/eventing";
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
  {
    externalId = "acme-external-id",
    receiveFailure,
  }: { externalId?: string | null; receiveFailure?: unknown } = {},
) {
  const memory = MemorySecurityLakeQueueChannel.create();
  const seen: GovernanceObjectStorageCredentials[] = [];
  const queue: SecurityLakeQueue = {
    receive: async (input) => {
      seen.push(input.credentials);
      if (receiveFailure !== undefined) throw receiveFailure;
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
      await expect(run({}, { externalId: null })).rejects.toMatchObject({
        retryable: false,
        customerMessage: expect.stringMatching(/no external id/),
      });
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
      const seen = await run({
        sqsEndpoint: "http://localhost:4566",
        s3Endpoint: "http://localhost:4566",
      });

      expect(seen[0]?.assumeRole).toBeUndefined();
    });
  });

  describe("given an emulator for S3 but SQS on AWS", () => {
    it("still reads the queue as the subscriber role, assumed with the external id", async () => {
      const seen = await run({ s3Endpoint: "http://localhost:4566" });

      expect(seen[0]?.assumeRole).toEqual({ roleArn: ROLE, externalId: "acme-external-id" });
    });

    it("refuses without the generated external id", async () => {
      await expect(
        run({ s3Endpoint: "http://localhost:4566" }, { externalId: null }),
      ).rejects.toMatchObject({ retryable: false });
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

  describe("when AWS refuses the source's own setup", () => {
    it("fails the run as a refusal the customer fixes, not one to retry", async () => {
      const denied = Object.assign(new Error("User arn:aws:iam::1:user/x is not authorized"), {
        name: "AccessDenied",
        $metadata: { httpStatusCode: 403 },
      });

      const failure = await run({}, { receiveFailure: denied }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(DispatchError);
      expect(failure).toMatchObject({
        retryable: false,
        customerMessage: "The AWS request failed with AccessDenied.",
        cause: denied,
      });
    });
  });

  describe("when AWS throttles the queue with a 400", () => {
    it("fails the run as retryable, since throttling passes", async () => {
      const throttled = Object.assign(new Error("Request is throttled."), {
        name: "RequestThrottled",
        $metadata: { httpStatusCode: 400 },
      });

      const failure = await run({}, { receiveFailure: throttled }).catch((e: unknown) => e);

      expect(failure).toMatchObject({ retryable: true });
    });
  });

  describe("when AWS is briefly unavailable", () => {
    it("fails the run as retryable, with only the error code in its message", async () => {
      const unavailable = Object.assign(new Error("internal detail"), {
        name: "ServiceUnavailable",
        $metadata: { httpStatusCode: 503 },
      });

      const failure = await run({}, { receiveFailure: unavailable }).catch((e: unknown) => e);

      expect(failure).toMatchObject({
        retryable: true,
        message: "The AWS request failed with ServiceUnavailable.",
      });
    });
  });

  describe("when the run's budget ends it with messages still on the queue", () => {
    it("reports the run truncated and does not claim it read through to now", async () => {
      const queue = MemorySecurityLakeQueueChannel.create();
      queue.send({ body: "{}" });
      const reader = SecurityLakeReaderService.create({
        queue,
        objects: MemoryObjectStoreChannel.create(),
        events: MemoryOcsfEventsRepository.create(),
        runBudget: { maxMs: 0, maxBytes: 1 },
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
        sqsEndpoint: "http://localhost:4566",
        s3Endpoint: "http://localhost:4566",
      });

      const result = await puller.runOnce(
        {
          context: { organizationId: "org_acme", ingestionSourceId: "src_1" },
          credentials: { aws_access_key_id: "AKIAACME", aws_secret_access_key: "secret" },
          cursor: null,
        } as never,
        config,
      );

      expect(result.completeness).toBe("truncated");
      expect(result.readThroughAt).toBeUndefined();
      expect(queue.pending()).toHaveLength(1);
    });
  });
});
