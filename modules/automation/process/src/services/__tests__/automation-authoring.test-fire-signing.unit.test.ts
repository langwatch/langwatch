/**
 * @vitest-environment node
 * A webhook test fire signs with the saved automation's secret only at the saved URL.
 * @see specs/automations/webhook-http-action.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  automationApiTestFireInputSchema,
  type TestFireInput,
  type TestFireResult,
} from "@langwatch/automation-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { SilentLogger } from "../../__tests__/fixtures/graph-activity.fixture.ts";
import {
  createTestSlackConnections,
  createTestSlackDestinations,
} from "../../__tests__/testing.ts";
import { triggerRow } from "../../transport/__tests__/automation-rest-redaction.fixture.ts";
import { AutomationAuthoringService } from "../automation-authoring.service.ts";
import { AutomationRulesService } from "../automation-rules.service.ts";
import type { AutomationService } from "../automation.service.ts";

const SAVED_URL = "https://receiver.acme.test/hook";

function authoringOverSavedWebhook({
  deleted = false,
  limit = { allowed: true, resetAt: 0 },
}: { deleted?: boolean; limit?: { allowed: boolean; resetAt: number } } = {}) {
  const testFire = vi.fn(async (_input: TestFireInput): Promise<TestFireResult> => ({
    channel: "webhook",
    recipientCount: 1,
    usedDefault: true,
    missingVariables: [],
    errors: [],
    httpStatus: 200,
  }));
  const saved = triggerRow({
    id: "trigger-1",
    action: "SEND_WEBHOOK",
    deleted,
    actionParams: { url: SAVED_URL, signingSecretEncrypted: "enc" },
  });
  const service = createApiFixture<AutomationService>({
    findById: async () => saved,
    testFire,
  });
  const rules = AutomationRulesService.create({
    automation: service,
    projects: createApiFixture<ProjectApi>({
      findSummaryById: async () => ({ name: "Acme", slug: "acme" }),
    }),
  });
  const authoring = AutomationAuthoringService.create({
    automation: service,
    rules,
    monitors: createApiFixture<MonitorApi>({ getAllByIds: async () => [] }),
    providers: {
      actionParamsSchemaFor: () => ({ safeParse: (data: unknown) => ({ success: true, data }) }),
      persistActionParamsFor: async (_action, args) => args.incoming,
      redactActionParamsFor: (_action, params) => params,
      decryptWebhookHeaders: () => ({}),
      decryptWebhookSigningSecrets: () => ["whsec_saved"],
    },
    slackChannels: { list: async () => ({ channels: [], error: null, gaps: [] }) },
    slackDestinations: createTestSlackDestinations(),
    slackConnections: createTestSlackConnections(),
    traceFilters: { assertCompiles: () => undefined },
    limits: { count: async () => limit },
    filterValidation: { assertWritable: async () => undefined },
    logger: new SilentLogger(),
  });

  return { authoring, testFire };
}

function webhookTestFire(url: string) {
  return automationApiTestFireInputSchema.parse({
    projectId: "project-1",
    channel: "webhook",
    trigger: { name: "High latency" },
    draft: {},
    automationId: "trigger-1",
    webhookDestination: { url, contentType: "text/plain" },
  });
}

const AUTHOR = { id: "user-1", email: "author@acme.test" };

describe("a webhook test fire of a saved, signed automation", () => {
  describe("when the draft keeps the saved URL", () => {
    it("signs with the stored secret and keeps the declared content type", async () => {
      const { authoring, testFire } = authoringOverSavedWebhook();

      await authoring.testFire({ input: webhookTestFire(SAVED_URL), author: AUTHOR });

      expect(testFire.mock.calls[0]?.[0].webhookDestination).toMatchObject({
        url: SAVED_URL,
        signingSecrets: ["whsec_saved"],
        contentType: "text/plain",
      });
    });
  });

  describe("when the draft points at a different URL", () => {
    /** @scenario "A test fire at a changed URL is not signed with the stored secret" */
    it("refuses and sends nothing", async () => {
      const { authoring, testFire } = authoringOverSavedWebhook();

      await expect(
        authoring.testFire({
          input: webhookTestFire("https://attacker.example/collect"),
          author: AUTHOR,
        }),
      ).rejects.toMatchObject({
        code: "test_fire_unavailable",
        message: expect.stringMatching(/save the new destination url/i),
      });
      expect(testFire).not.toHaveBeenCalled();
    });
  });
});

describe("a webhook test fire once the window's allowance is spent", () => {
  /** @scenario "Test fires are rate limited" */
  it("is declined, asking the author to retry later, and sends nothing", async () => {
    const { authoring, testFire } = authoringOverSavedWebhook({
      limit: { allowed: false, resetAt: Date.now() + 42_000 },
    });

    await expect(
      authoring.testFire({ input: webhookTestFire(SAVED_URL), author: AUTHOR }),
    ).rejects.toMatchObject({
      code: "test_fire_rate_limited",
      message: expect.stringMatching(/too many test fires/i),
    });
    expect(testFire).not.toHaveBeenCalled();
  });
});

describe("reading one automation for the drawer", () => {
  describe("given the automation was deleted", () => {
    it("reads as missing, as it does in the list", async () => {
      const { authoring } = authoringOverSavedWebhook({ deleted: true });

      await expect(
        authoring.findRedactedById({ triggerId: "trigger-1", projectId: "project-1" }),
      ).resolves.toBeNull();
    });
  });
});
