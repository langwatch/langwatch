import { WebhookEndpointValidationError } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import type { WebhookId, WebhookSecret } from "../../app/webhook.app.ts";
import { MemoryWebhookEndpointRepository } from "../../repositories/memory/memory.webhook-endpoint.repository.ts";
import { MemoryWebhookDatabase } from "../../repositories/memory/memory.webhook.database.ts";
import {
  webhookEndpointConfiguration,
  type WebhookEndpointConfigurationInput,
} from "../../rules/webhook-endpoint-policy.rules.ts";
import { WebhookEndpointService } from "../webhook-endpoint.service.ts";

const organizationId = "organization-1";
const enabledEvents = ["gateway.request.completed"];
const CANONICAL_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/webhooks-queue";

let endpointCount = 0;
const ids: WebhookId = {
  newEndpointId: () => `webhook_endpoint_${(endpointCount += 1)}`,
};
const secrets: WebhookSecret = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
};

const service = (configuration: WebhookEndpointConfigurationInput = {}) =>
  WebhookEndpointService.create({
    endpoints: MemoryWebhookEndpointRepository.create({
      database: MemoryWebhookDatabase.create(),
      options: { ids, secrets },
    }),
    configuration: webhookEndpointConfiguration(configuration),
  });

describe("WebhookEndpointService", () => {
  describe("given the deployment did not set the unsafe local-URLs flag", () => {
    /** @scenario Plain-http receiver URLs need the operator opt-in */
    it("refuses a plain-http endpoint and accepts it once the flag is set", async () => {
      const url = "http://example.com/hooks";
      await expect(service().create({ organizationId, url, enabledEvents })).rejects.toBeInstanceOf(
        WebhookEndpointValidationError,
      );

      const { endpoint } = await service({ allowInsecureLocalUrls: true }).create({
        organizationId,
        url,
        enabledEvents,
      });
      expect(endpoint.url).toBe(url);
    });
  });

  describe("when an endpoint is saved with a queue URL ending in .fifo", () => {
    /** @scenario A FIFO queue is refused at save time */
    it("is refused as standard queues only", async () => {
      await expect(
        service().create({
          organizationId,
          destinationKind: "sqs",
          sqs: { queueUrl: `${CANONICAL_QUEUE_URL}.fifo` },
          enabledEvents,
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
      await expect(
        service().create({
          organizationId,
          destinationKind: "sqs",
          sqs: { queueUrl: "https://example.com/not-a-queue" },
          enabledEvents,
        }),
      ).rejects.toMatchObject({ code: "webhook_endpoint_invalid" });
    });
  });

  describe("given the deployment did not set the unsafe ambient-credentials flag", () => {
    /** @scenario Ambient AWS credentials need the operator opt-in */
    it("refuses a queue endpoint with no credentials of its own, accepting it once the flag is set", async () => {
      const input = {
        organizationId,
        destinationKind: "sqs" as const,
        sqs: { queueUrl: CANONICAL_QUEUE_URL },
        enabledEvents,
      };
      await expect(service().create(input)).rejects.toBeInstanceOf(WebhookEndpointValidationError);

      const { endpoint } = await service({ allowAmbientAwsCredentials: true }).create(input);
      expect(endpoint.sqs?.credentialMode).toBe("ambient");
    });
  });

  describe("when an endpoint of a kind is saved without the field that kind requires", () => {
    /** @scenario Saving an endpoint names the field its destination kind is missing */
    it("names the missing field rather than the whole body", async () => {
      await expect(
        service().create({ organizationId, destinationKind: "http", enabledEvents }),
      ).rejects.toMatchObject({
        code: "webhook_endpoint_invalid",
        message: expect.stringContaining("url"),
      });

      await expect(
        service().create({ organizationId, destinationKind: "sqs", enabledEvents }),
      ).rejects.toMatchObject({
        code: "webhook_endpoint_invalid",
        message: expect.stringContaining("sqs.queue_url"),
      });
    });
  });

  describe("when an endpoint is saved naming one kind and the other kind's address", () => {
    /** @scenario Saving an endpoint refuses the address of the other destination kind */
    it("refuses the field that does not belong", async () => {
      await expect(
        service().create({
          organizationId,
          destinationKind: "http",
          url: "https://example.com/hooks",
          sqs: { queueUrl: CANONICAL_QUEUE_URL },
          enabledEvents,
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
      const endpoints = service();
      const { endpoint } = await endpoints.create({
        organizationId,
        url: "https://example.com/hooks",
        enabledEvents,
      });

      await expect(
        endpoints.update({ organizationId, endpointId: endpoint.id, destinationKind: "sqs" }),
      ).rejects.toMatchObject({ code: "webhook_endpoint_invalid" });
    });
  });

  describe("when an endpoint is saved with a selector the registry does not know", () => {
    /** @scenario Unknown event selectors are rejected at save time */
    it("is rejected with a validation error", async () => {
      await expect(
        service().create({
          organizationId,
          url: "https://example.com/hooks",
          enabledEvents: ["gateway.request.imagined"],
        }),
      ).rejects.toBeInstanceOf(WebhookEndpointValidationError);
    });
  });

  describe("when an endpoint is saved with no events selected", () => {
    it("is rejected with a validation error", async () => {
      await expect(
        service().create({ organizationId, url: "https://example.com/hook", enabledEvents: [] }),
      ).rejects.toBeInstanceOf(WebhookEndpointValidationError);
    });
  });
});
