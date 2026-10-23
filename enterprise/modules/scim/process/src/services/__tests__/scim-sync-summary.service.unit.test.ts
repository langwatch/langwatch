// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { MemoryScimSyncSummaryChannel } from "../../channels/memory/memory.scim-sync-summary.channel.ts";
import { SlackScimSyncSummaryChannel } from "../../channels/slack/slack.scim-sync-summary.channel.ts";
import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import { ScimSyncSummaryService } from "../scim-sync-summary.service.ts";

const ORGANIZATION = "organization_acme";
const SENT_AT = 1_760_000_000_000;

const summary = {
  organizationId: ORGANIZATION,
  added: 2,
  updated: 1,
  deactivated: 1,
  failed: 1,
  addedUserIds: ["user_ada", "user_unknown"],
};

async function directory(): Promise<MemoryScimRepository> {
  const repository = MemoryScimRepository.create();
  repository.organizations.set(ORGANIZATION, { id: ORGANIZATION, ssoDomain: null, name: "Acme" });
  await repository.saveUserResource({
    organizationId: ORGANIZATION,
    userId: "user_ada",
    userName: "ada@acme.test",
    name: "Ada Lovelace",
    active: true,
  });
  return repository;
}

describe("posting a SCIM push summary", () => {
  /** @scenario "A quiet push posts one card with its counts" */
  it("posts one card naming the organization, its counts and the people added", async () => {
    const channel = MemoryScimSyncSummaryChannel.create();
    const { logger } = createTestLogger();
    const service = ScimSyncSummaryService.create({
      channel,
      publicBaseUrl: "https://app.acme.test",
      directory: await directory(),
      logger,
      now: () => SENT_AT,
    });

    await service.post(summary);

    expect(channel.posted).toHaveLength(1);
    const card = JSON.stringify(channel.posted[0]);
    expect(card).toContain("SCIM updated Acme");
    expect(card).toContain("2 added");
    expect(card).toContain("1 updated");
    expect(card).toContain("1 deactivated");
    expect(card).toContain("1 failed");
    expect(card).toContain("Ada Lovelace");
  });

  /** @scenario "Without the sign-ups webhook the summary is skipped with a warning" */
  it("sends nothing and warns when the sign-ups webhook is unset", async () => {
    const { logger, lines } = createTestLogger();
    const service = ScimSyncSummaryService.create({
      channel: undefined,
      publicBaseUrl: undefined,
      directory: await directory(),
      logger,
    });

    await service.post(summary);

    expect(lines.findLine("warn", "skipping SCIM sync summary")).toBeDefined();
  });

  /** @scenario "A Slack failure is logged and never thrown" */
  it("logs a refused post and resolves", async () => {
    const { logger, lines } = createTestLogger();
    const service = ScimSyncSummaryService.create({
      channel: SlackScimSyncSummaryChannel.create({
        webhookUrl: "https://hooks.slack.test/refusing",
        createWebhook: () => ({
          send: async () => {
            throw new Error("slack said no");
          },
        }),
      }),
      publicBaseUrl: undefined,
      directory: await directory(),
      logger,
    });

    await expect(service.post(summary)).resolves.toBeUndefined();
    expect(lines.findLine("error", "could not be posted to Slack")).toMatchObject({
      organizationId: ORGANIZATION,
    });
  });
});
