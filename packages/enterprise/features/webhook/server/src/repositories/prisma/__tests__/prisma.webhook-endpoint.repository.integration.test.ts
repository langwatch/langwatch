// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The webhook endpoint repository against real Postgres, no mocks. Binds
 * the destination-admission, credential and secret-lifecycle scenarios of
 * specs/webhooks/webhook-endpoints.feature.
 *
 * Ported from platform/app/ee/webhooks/__tests__/webhookEndpoint.service.integration.test.ts
 * and the destination-admission half of
 * platform/app/src/app/api/webhooks/__tests__/webhooks-rest-api.integration.test.ts
 * (both retired with the application). This repository is the seam those
 * REST-level tests exercised through the route: everything they asserted
 * about admission and credential handling is decided here, before any
 * network hop, so the behaviour is pinned at the layer that owns it.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { WebhookEndpointValidationError } from "@langwatch/enterprise-webhook-contract";
import type { WebhookIdPort } from "../../../ports/webhook-id.port";
import type { WebhookSecretPort } from "../../../ports/webhook-secret.port";
import { WebhookEndpointConfiguration } from "../../../services/webhook-endpoint-policy.service";
import { PrismaWebhookEndpointRepository } from "../prisma.webhook-endpoint.repository";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ids: WebhookIdPort = {
  newEndpointId: () => `whep_${randomBytes(6).toString("hex")}`,
};

const secrets: WebhookSecretPort = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
};

const CANONICAL_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/webhooks-queue";
const ROLE_ARN = "arn:aws:iam::123456789012:role/webhook-sender";

describe.skipIf(!databaseUrl)("PrismaWebhookEndpointRepository", () => {
  const ns = `whep-${randomBytes(4).toString("hex")}`;
  const orgId = `org-${ns}`;
  let createdEndpointIds: string[] = [];

  const repository = (configuration?: WebhookEndpointConfiguration) =>
    PrismaWebhookEndpointRepository.create({ prisma, ids, secrets, configuration });

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: orgId, name: ns, slug: ns } });
  });

  afterAll(async () => {
    if (createdEndpointIds.length > 0) {
      await prisma.webhookEndpoint.deleteMany({ where: { id: { in: createdEndpointIds } } });
    }
    await prisma.organization.delete({ where: { id: orgId } });
    await connection?.closeOnce();
  });

  const create = async (
    repo: PrismaWebhookEndpointRepository,
    params: Parameters<PrismaWebhookEndpointRepository["create"]>[0],
  ) => {
    const result = await repo.create(params);
    createdEndpointIds.push(result.endpoint.id);
    return result;
  };

  describe("given the deployment did not set the unsafe local-URLs flag", () => {
    /** @scenario Plain-http receiver URLs need the operator opt-in */
    it("refuses a plain-http endpoint and accepts it once the flag is set", async () => {
      const repo = repository();
      await expect(
        repo.create({
          organizationId: orgId,
          url: "http://example.com/hooks",
          enabledEvents: ["gateway.request.completed"],
        }),
      ).rejects.toBeInstanceOf(WebhookEndpointValidationError);

      const permissive = repository(
        WebhookEndpointConfiguration.create({ allowInsecureLocalUrls: true }),
      );
      const { endpoint } = await create(permissive, {
        organizationId: orgId,
        url: "http://example.com/hooks",
        enabledEvents: ["gateway.request.completed"],
      });
      expect(endpoint.url).toBe("http://example.com/hooks");
    });
  });

  describe("given an endpoint saved with only a receiver URL", () => {
    /** @scenario An endpoint saved before destinations existed still delivers over HTTPS */
    it("defaults to the http destination kind and delivers over HTTPS", async () => {
      const repo = repository();
      const { endpoint } = await create(repo, {
        organizationId: orgId,
        url: "https://example.com/hooks",
        enabledEvents: ["gateway.request.completed"],
      });
      expect(endpoint.destinationKind).toBe("http");

      const destination = await repo.getDestinationConfig({
        organizationId: orgId,
        endpointId: endpoint.id,
      });
      expect(destination).toEqual({ kind: "http", url: "https://example.com/hooks" });
    });
  });

  describe("when an endpoint is saved with a queue URL ending in .fifo", () => {
    /** @scenario A FIFO queue is refused at save time */
    it("is refused as standard queues only", async () => {
      const repo = repository();
      await expect(
        create(repo, {
          organizationId: orgId,
          destinationKind: "sqs",
          sqs: { queueUrl: `${CANONICAL_QUEUE_URL}.fifo` },
          enabledEvents: ["gateway.request.completed"],
        }),
      ).rejects.toMatchObject({
        code: "webhook_endpoint_invalid",
        message: expect.stringContaining("standard queue"),
      });
    });
  });

  describe("when an endpoint is saved with a queue URL that is not an Amazon SQS queue URL", () => {
    /** @scenario A queue URL outside the canonical Amazon SQS shape is refused */
    it("is refused as invalid", async () => {
      const repo = repository();
      await expect(
        create(repo, {
          organizationId: orgId,
          destinationKind: "sqs",
          sqs: { queueUrl: "https://example.com/not-a-queue" },
          enabledEvents: ["gateway.request.completed"],
        }),
      ).rejects.toMatchObject({ code: "webhook_endpoint_invalid" });
    });
  });

  describe("given the deployment did not set the unsafe ambient-credentials flag", () => {
    /** @scenario Ambient AWS credentials need the operator opt-in */
    it("refuses a queue endpoint with no credentials of its own, accepting it once the flag is set", async () => {
      const repo = repository();
      await expect(
        repo.create({
          organizationId: orgId,
          destinationKind: "sqs",
          sqs: { queueUrl: CANONICAL_QUEUE_URL },
          enabledEvents: ["gateway.request.completed"],
        }),
      ).rejects.toBeInstanceOf(WebhookEndpointValidationError);

      const permissive = repository(
        WebhookEndpointConfiguration.create({ allowAmbientAwsCredentials: true }),
      );
      const { endpoint } = await create(permissive, {
        organizationId: orgId,
        destinationKind: "sqs",
        sqs: { queueUrl: CANONICAL_QUEUE_URL },
        enabledEvents: ["gateway.request.completed"],
      });
      expect(endpoint.sqs?.credentialMode).toBe("ambient");
    });
  });

  describe("when an endpoint is saved with a static access key and secret", () => {
    /** @scenario A queue's secret access key is never readable once saved */
    it("never returns the secret from any read of the endpoint", async () => {
      const repo = repository();
      const { endpoint } = await create(repo, {
        organizationId: orgId,
        destinationKind: "sqs",
        sqs: {
          queueUrl: CANONICAL_QUEUE_URL,
          accessKeyId: "AKIA_TEST_KEY",
          secretAccessKey: "super-secret-value",
        },
        enabledEvents: ["gateway.request.completed"],
      });
      expect(JSON.stringify(endpoint)).not.toContain("super-secret-value");

      const read = await repo.getById({ organizationId: orgId, endpointId: endpoint.id });
      expect(JSON.stringify(read)).not.toContain("super-secret-value");

      const all = await repo.getAll({ organizationId: orgId });
      expect(JSON.stringify(all)).not.toContain("super-secret-value");
    });
  });

  describe("given a queue endpoint that assumes a role", () => {
    /** @scenario Switching credential mode drops the mode it left */
    it("reports the static mode and drops the role once static credentials are set", async () => {
      const repo = repository();
      const { endpoint } = await create(repo, {
        organizationId: orgId,
        destinationKind: "sqs",
        sqs: { queueUrl: CANONICAL_QUEUE_URL, roleArn: ROLE_ARN },
        enabledEvents: ["gateway.request.completed"],
      });
      expect(endpoint.sqs?.credentialMode).toBe("assume_role");

      const updated = await repo.update({
        organizationId: orgId,
        endpointId: endpoint.id,
        sqs: { accessKeyId: "AKIA_TEST_KEY", secretAccessKey: "super-secret-value" },
      });
      expect(updated.sqs?.credentialMode).toBe("static");
      expect(updated.sqs?.roleArn).toBeNull();
      expect(updated.sqs?.externalId).toBeNull();

      await expect(
        repo.update({
          organizationId: orgId,
          endpointId: endpoint.id,
          sqs: { roleArn: ROLE_ARN, accessKeyId: "AKIA_TEST_KEY", secretAccessKey: "x" },
        }),
      ).rejects.toBeInstanceOf(WebhookEndpointValidationError);
    });
  });

  describe("when an endpoint of a kind is saved without the field that kind requires", () => {
    /** @scenario Saving an endpoint names the field its destination kind is missing */
    it("names the missing field rather than the whole body", async () => {
      const repo = repository();
      await expect(
        repo.create({
          organizationId: orgId,
          destinationKind: "http",
          enabledEvents: ["gateway.request.completed"],
        }),
      ).rejects.toMatchObject({
        code: "webhook_endpoint_invalid",
        message: expect.stringContaining("url"),
      });

      await expect(
        repo.create({
          organizationId: orgId,
          destinationKind: "sqs",
          enabledEvents: ["gateway.request.completed"],
        }),
      ).rejects.toMatchObject({
        code: "webhook_endpoint_invalid",
        message: expect.stringContaining("sqs.queue_url"),
      });
    });
  });

  describe("when an endpoint is saved naming one kind and the other kind's address", () => {
    /** @scenario Saving an endpoint refuses the address of the other destination kind */
    it("refuses the field that does not belong", async () => {
      const repo = repository();
      await expect(
        repo.create({
          organizationId: orgId,
          destinationKind: "http",
          url: "https://example.com/hooks",
          sqs: { queueUrl: CANONICAL_QUEUE_URL },
          enabledEvents: ["gateway.request.completed"],
        }),
      ).rejects.toMatchObject({
        code: "webhook_endpoint_invalid",
        message: expect.stringContaining("sqs does not apply"),
      });
    });
  });

  describe("given an endpoint that delivers over HTTP", () => {
    /** @scenario An endpoint never changes its destination kind */
    it("refuses an update asking for the queue kind", async () => {
      const repo = repository();
      const { endpoint } = await create(repo, {
        organizationId: orgId,
        url: "https://example.com/hooks",
        enabledEvents: ["gateway.request.completed"],
      });

      await expect(
        repo.update({
          organizationId: orgId,
          endpointId: endpoint.id,
          destinationKind: "sqs",
        }),
      ).rejects.toMatchObject({ code: "webhook_endpoint_invalid" });
    });
  });

  describe("when an endpoint is saved with a selector the registry does not know", () => {
    /** @scenario Unknown event selectors are rejected at save time */
    it("is rejected with a validation error", async () => {
      const repo = repository();
      await expect(
        repo.create({
          organizationId: orgId,
          url: "https://example.com/hooks",
          enabledEvents: ["gateway.request.imagined"],
        }),
      ).rejects.toBeInstanceOf(WebhookEndpointValidationError);
    });
  });

  describe("when an endpoint is created", () => {
    /** @scenario The signing secret is returned only at create and roll time */
    it("carries the secret once, never again from a read surface", async () => {
      const repo = repository();
      const { endpoint, secret } = await create(repo, {
        organizationId: orgId,
        url: "https://example.com/hooks",
        enabledEvents: ["gateway.request.completed"],
      });
      expect(secret).toMatch(/^whsec_/);
      expect(JSON.stringify(endpoint)).not.toContain(secret);

      const read = await repo.getById({ organizationId: orgId, endpointId: endpoint.id });
      expect(JSON.stringify(read)).not.toContain(secret);

      const { secret: rolled } = await repo.rollSecret({
        organizationId: orgId,
        endpointId: endpoint.id,
      });
      expect(rolled).not.toBe(secret);
    });
  });

  describe("given a signing secret that was just rolled", () => {
    /** @scenario A rolled secret keeps signing for a grace window */
    it("returns both secrets inside the window and only the new one after it", async () => {
      const repo = repository();
      const { endpoint, secret: original } = await create(repo, {
        organizationId: orgId,
        url: "https://example.com/hooks",
        enabledEvents: ["gateway.request.completed"],
      });
      const rolledAt = new Date();
      const { secret: rolled } = await repo.rollSecret({
        organizationId: orgId,
        endpointId: endpoint.id,
        now: rolledAt,
      });

      const insideWindow = await repo.getSigningSecrets({
        organizationId: orgId,
        endpointId: endpoint.id,
        now: new Date(rolledAt.getTime() + 60 * 60 * 1000),
      });
      expect(insideWindow).toEqual([rolled, original]);

      const afterWindow = await repo.getSigningSecrets({
        organizationId: orgId,
        endpointId: endpoint.id,
        now: new Date(rolledAt.getTime() + 25 * 60 * 60 * 1000),
      });
      expect(afterWindow).toEqual([rolled]);
    });
  });
});
