/**
 * @vitest-environment node
 * @unit
 * @see modules/github/specs/github-installation-connected.feature
 */
import { createTenantId, type Command } from "@langwatch/eventing";
import {
  GITHUB_INSTALLATION_AGGREGATE_TYPE,
  GITHUB_INSTALLATION_CONNECTED_EVENT_TYPE,
} from "@langwatch/github-contract";
import { describe, expect, it } from "vitest";

import {
  GithubInstallationFactsService,
  type GithubLifecycleSenders,
} from "../../services/github-installation-facts.service.ts";
import { RecordInstallationConnectedCommand } from "../github-lifecycle.commands.ts";
import type { RecordInstallationConnectedCommandData } from "../github-lifecycle.events.ts";

function recordingSenders(): {
  senders: GithubLifecycleSenders;
  sent: RecordInstallationConnectedCommandData[];
} {
  const sent: RecordInstallationConnectedCommandData[] = [];
  return {
    sent,
    senders: { recordInstallationConnected: { send: async (data) => void sent.push(data) } },
  };
}

describe("GitHub's installation connected fact", () => {
  describe("when an installation is connected", () => {
    /** @scenario "a completed installation records that it was connected" */
    it("sends one fact of ids, keyed to the organization", async () => {
      const { senders, sent } = recordingSenders();
      const facts = GithubInstallationFactsService.create();
      facts.connect(senders);

      await facts.recordInstallationConnected({
        organizationId: "organization-1",
        installationId: "installation-1",
      });

      expect(sent).toEqual([
        {
          tenantId: "organization-1",
          organizationId: "organization-1",
          installationId: "installation-1",
          occurredAt: expect.any(Number),
        },
      ]);
    });

    /** @scenario "an installation connect outside a registered pipeline is refused by name" */
    it("refuses by name when github_lifecycle is not registered", async () => {
      const facts = GithubInstallationFactsService.create();

      await expect(
        facts.recordInstallationConnected({
          organizationId: "organization-1",
          installationId: "installation-1",
        }),
      ).rejects.toThrow("github_lifecycle is not registered in this process");
    });
  });

  describe("when the record command is redelivered", () => {
    /** @scenario "a redelivered installation connected command records nothing new" */
    it("produces one idempotency key for both deliveries", () => {
      const data: RecordInstallationConnectedCommandData = {
        tenantId: "organization-1",
        organizationId: "organization-1",
        installationId: "installation-1",
        occurredAt: 1_500,
      };
      const command: Command<RecordInstallationConnectedCommandData> = {
        tenantId: createTenantId("organization-1"),
        aggregateId: "installation-1",
        type: "lw.github.record_installation_connected",
        data,
      };
      const handler = new RecordInstallationConnectedCommand();

      const [first] = handler.handle(command);
      const [second] = handler.handle(command);

      expect(first?.type).toBe(GITHUB_INSTALLATION_CONNECTED_EVENT_TYPE);
      expect(first?.aggregateType).toBe(GITHUB_INSTALLATION_AGGREGATE_TYPE);
      expect(first?.aggregateId).toBe("installation-1");
      expect(first?.idempotencyKey).toBeDefined();
      expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
    });
  });
});
