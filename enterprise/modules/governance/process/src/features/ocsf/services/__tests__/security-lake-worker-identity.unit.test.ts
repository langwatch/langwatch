// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Spec: enterprise/modules/governance/specs/security-lake-ingest.feature */

import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { SQSClient } from "@aws-sdk/client-sqs";
import {
  securityLakePullConfigSchema,
  securityLakeSourceCreateInputSchema,
} from "@langwatch/enterprise-governance-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { S3ObjectStoreChannel } from "../../../../channels/s3/s3.object-store.channel.ts";
import { SqsSecurityLakeQueueChannel } from "../../../../channels/sqs/sqs.security-lake-queue.channel.ts";
import { MemoryOcsfEventsRepository } from "../../../../repositories/memory/memory.ocsf-events.repository.ts";
import { findPullCredentialComplaints } from "../../../ingestion-pull/rules/pull-config-shape.rules.ts";
import {
  type InternalTenants,
  SecurityLakePullerService,
} from "../security-lake-puller.service.ts";
import { SecurityLakeReaderService } from "../security-lake-reader.service.ts";

const WORKER_KEY = "AKIAWORKERAMBIENT0001";
const TENANT_KEY = "AKIATENANTOWNKEY0001";
const WORKER_ROLE = "arn:aws:sts::111122223333:assumed-role/langwatch-worker/i-0abc";

type Captured = { method: string; url: string; headers: IncomingHttpHeaders };
const captured: Captured[] = [];
let server: Server;
let endpoint: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    captured.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
    req.resume();
    req.on("end", () => {
      res.writeHead(403, {
        "content-type": "application/x-amz-json-1.0",
        "x-amzn-query-error": "AccessDenied;Sender",
      });
      res.end(
        JSON.stringify({
          __type: "com.amazonaws.sqs#AccessDenied",
          message: `User: ${WORKER_ROLE} is not authorized to perform sqs:ReceiveMessage`,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

afterEach(() => {
  captured.length = 0;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function pull({
  credentials,
  overrides = {},
}: {
  credentials: Record<string, string> | undefined;
  overrides?: Record<string, unknown>;
}) {
  vi.stubEnv("AWS_ACCESS_KEY_ID", WORKER_KEY);
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "worker-secret");
  vi.stubEnv("AWS_SESSION_TOKEN", "worker-session-token");
  const egress = { blockLocal: false, allowedHosts: [] };
  const reader = SecurityLakeReaderService.create({
    queue: SqsSecurityLakeQueueChannel.create({ egress }),
    objects: S3ObjectStoreChannel.create({ egress }),
    events: MemoryOcsfEventsRepository.create(),
  });
  const puller = SecurityLakePullerService.create({
    reader,
    projects: createApiFixture<InternalTenants>({
      ensureInternal: async () => ({ id: "project_governance" }),
    }),
  });
  const config = securityLakePullConfigSchema.parse({
    adapter: "aws_security_lake",
    region: "eu-west-1",
    subscriberRoleArn: "arn:aws:iam::444455556666:role/VictimRole",
    queueUrl: "https://sqs.eu-west-1.amazonaws.com/444455556666/victim-subscriber",
    ...overrides,
  });
  return puller.runOnce(
    {
      context: { organizationId: "org_acme", ingestionSourceId: "src_1" },
      credentials,
      cursor: null,
    } as never,
    config,
  );
}

function signedKeys(): string[] {
  return captured.map((request) => String(request.headers.authorization ?? ""));
}

/** A run refused for missing keys: not retried, and the customer told which keys to add. */
const KEYS_MISSING = {
  retryable: false,
  customerMessage: expect.stringMatching(/add the access key ID and secret access key/),
};

describe("Security Lake pull and the worker's own AWS identity", () => {
  describe("given a source saved with no key pair", () => {
    /** @scenario "A source without its own key pair never uses the worker's AWS identity" */
    it("refuses before any AWS client signs a request", async () => {
      const send = vi.spyOn(SQSClient.prototype, "send");

      await expect(pull({ credentials: undefined })).rejects.toMatchObject(KEYS_MISSING);

      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("given keys of blank strings", () => {
    /** @scenario "A source without its own key pair never uses the worker's AWS identity" */
    it("refuses them at save, on both create paths, and at run time", async () => {
      const blank = { aws_access_key_id: " ", aws_secret_access_key: " " };
      const create = securityLakeSourceCreateInputSchema.safeParse({
        name: "ACME lake",
        config: {
          region: "eu-west-1",
          subscriberRoleArn: "arn:aws:iam::444455556666:role/VictimRole",
          queueUrl: "https://sqs.eu-west-1.amazonaws.com/444455556666/victim-subscriber",
        },
        credentials: blank,
      });
      expect(create.success).toBe(false);
      expect(
        findPullCredentialComplaints({ adapter: "aws_security_lake", credentials: blank }),
      ).toHaveLength(1);
      const send = vi.spyOn(SQSClient.prototype, "send");

      await expect(pull({ credentials: blank })).rejects.toMatchObject(KEYS_MISSING);

      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("given a non-AWS queue endpoint and no key pair", () => {
    /** @scenario "A source without its own key pair never uses the worker's AWS identity" */
    it("sends nothing to the tenant's host", async () => {
      await expect(
        pull({
          credentials: undefined,
          overrides: { sqsEndpoint: endpoint, s3Endpoint: endpoint, queueUrl: `${endpoint}/q` },
        }),
      ).rejects.toMatchObject(KEYS_MISSING);

      expect(captured).toHaveLength(0);
    });
  });

  describe("given a non-AWS queue endpoint and the tenant's own keys", () => {
    /** @scenario "A source without its own key pair never uses the worker's AWS identity" */
    it("signs with the tenant's key only and keeps AWS error text out of the result", async () => {
      const failure = await pull({
        credentials: { aws_access_key_id: TENANT_KEY, aws_secret_access_key: "tenant-secret" },
        overrides: { sqsEndpoint: endpoint, s3Endpoint: endpoint, queueUrl: `${endpoint}/q` },
      }).then(
        () => null,
        (error: unknown) => error as Error,
      );

      expect(captured.length).toBeGreaterThan(0);
      expect(signedKeys().every((header) => header.includes(TENANT_KEY))).toBe(true);
      expect(signedKeys().some((header) => header.includes(WORKER_KEY))).toBe(false);
      expect(captured.some((request) => request.headers["x-amz-security-token"])).toBe(false);
      expect(failure?.message).toBe("The AWS request failed with AccessDenied.");
    });
  });
});
