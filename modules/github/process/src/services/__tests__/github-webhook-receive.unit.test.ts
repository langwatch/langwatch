/**
 * @vitest-environment node
 * The webhook door on the real GithubFeatureService: secret, then signature, then apply.
 */
import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { GithubModule } from "../../app/github.app.ts";
import { MemoryGithubRepositories } from "../../repositories/memory/memory.github.repositories.ts";
import { TestOrganizationService, TestProjectService } from "./fixtures/github-services.fixture.ts";

const rawBody = JSON.stringify({ zen: "Keep it logically awesome." });

function harness({ webhookSecret }: { webhookSecret: string }) {
  const github = GithubModule.composeApi({
    repositories: MemoryGithubRepositories.create(),
    config: {
      appId: "test-app",
      privateKey: "unused-private-key",
      appSlug: "test-app",
      webhookSecret,
      signingKey: "test-signing-key",
    },
    organization: new TestOrganizationService().api,
    project: new TestProjectService("org-1"),
  });
  const apply = vi.spyOn(github, "applyWebhookPayload");

  return { github, apply };
}

function sign({ body, secret }: { body: string; secret: string }): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("GithubFeatureService.receiveWebhook", () => {
  describe("when the signature does not match the secret", () => {
    it("refuses with invalid_signature and applies nothing", async () => {
      const { github, apply } = harness({ webhookSecret: "real-secret" });

      const receipt = await github.receiveWebhook({
        rawBody,
        signature: sign({ body: rawBody, secret: "wrong-secret" }),
        eventType: "ping",
        deliveryId: "delivery-1",
      });

      expect(receipt).toEqual({ refused: "invalid_signature" });
      expect(apply).not.toHaveBeenCalled();
    });
  });

  describe("when no webhook secret is configured", () => {
    it("refuses with not_configured and applies nothing", async () => {
      const { github, apply } = harness({ webhookSecret: "" });

      const receipt = await github.receiveWebhook({
        rawBody,
        signature: sign({ body: rawBody, secret: "anything" }),
        eventType: "ping",
        deliveryId: "delivery-2",
      });

      expect(receipt).toEqual({ refused: "not_configured" });
      expect(apply).not.toHaveBeenCalled();
    });
  });

  describe("when the body is signed with the configured secret", () => {
    it("applies the payload once", async () => {
      const { github, apply } = harness({ webhookSecret: "real-secret" });

      const receipt = await github.receiveWebhook({
        rawBody,
        signature: sign({ body: rawBody, secret: "real-secret" }),
        eventType: "ping",
        deliveryId: "delivery-3",
      });

      expect(receipt).toEqual({ received: true });
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "ping", deliveryId: "delivery-3" }),
      );
    });
  });
});
