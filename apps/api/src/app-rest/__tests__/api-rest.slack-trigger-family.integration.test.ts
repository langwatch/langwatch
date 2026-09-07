/**
 * @vitest-environment node
 * The Slack alert trigger door, mounted the way this process mounts it.
 * @see specs/automations/slack-trigger-rest-api.feature
 */
import type { AutomationApp } from "@langwatch/automation-server";
import { describe, expect, it } from "vitest";

import { mountRestFamily, type MountedRestFamily } from "./support/rest-family.harness.ts";

const VALID_BODY = {
  slack_webhook: "https://hooks.slack.test/services/T/B/C",
  name: "Critical traces",
  alert_type: "CRITICAL",
};

/** Every spelling one route answers on: bare, `/api/v1`, and the two dated namespaces. */
const EVERY_SPELLING = [
  "/api/trigger/slack",
  "/api/v1/trigger/slack",
  "/api/2026-08-07/trigger/slack",
  "/api/latest/trigger/slack",
];

describe("given a caller holding the trigger permission", () => {
  describe("when a Slack trigger is created with an empty body", () => {
    /** @scenario "A body missing its required fields is refused by name" */
    it("answers 400 naming the refused fields, and creates nothing", async () => {
      const { api, created } = mountSlackTrigger();

      const response = await api.post("/api/trigger/slack", {});

      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        message: string;
        errors?: { field?: string }[];
      };
      expect(body.message).toBe("Invalid request data");
      expect(body.errors?.map((entry) => entry.field).sort()).toEqual([
        "alert_type",
        "name",
        "slack_webhook",
      ]);
      expect(created).toEqual([]);
    });
  });

  describe("when the body is not JSON", () => {
    /** @scenario "A body that is not JSON is refused" */
    it("answers 400 and creates nothing", async () => {
      const { api, created } = mountSlackTrigger();

      const response = await api.fetch("/api/trigger/slack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json at all",
      });

      expect(response.status).toBe(400);
      expect(created).toEqual([]);
    });
  });

  describe("when the body carries a webhook, a name and an alert type", () => {
    /** @scenario "A valid body creates the trigger" */
    it("creates the trigger with the Slack action", async () => {
      const { api, created } = mountSlackTrigger();

      const response = await api.post("/api/trigger/slack", VALID_BODY);

      expect(response.status).toBe(200);
      expect(created).toEqual([
        expect.objectContaining({
          action: "SEND_SLACK_MESSAGE",
          name: "Critical traces",
          alertType: "CRITICAL",
          actionParams: { slackWebhook: VALID_BODY.slack_webhook },
        }),
      ]);
    });
  });
});

describe("given a caller the credential chain does not authenticate", () => {
  describe("when a Slack trigger is created at every spelling of the route", () => {
    /** @scenario "Every spelling of the route demands the same credential" */
    it("refuses each of them, so no alias is a way past the credential", async () => {
      const refuse = (): never => {
        throw new Error("This caller holds no credential");
      };
      const { api, created } = mountSlackTrigger({ deny: refuse });

      for (const path of EVERY_SPELLING) {
        const response = await api.post(path, VALID_BODY);
        expect(response.status, `${path} must not create a trigger`).not.toBe(200);
      }
      expect(created).toEqual([]);
    });
  });
});

/** The family over an application that only records what it was asked to create. */
function mountSlackTrigger(caller: { deny?: () => never } = {}): {
  api: MountedRestFamily;
  created: Record<string, unknown>[];
} {
  const created: Record<string, unknown>[] = [];
  const automation = {
    create: async (input: Record<string, unknown>) => {
      created.push(input);
      return { id: "trigger-1" };
    },
  } as unknown as AutomationApp;

  const api = mountRestFamily({
    packaged: { automation: () => automation },
    ...(caller.deny ? { caller: { deny: caller.deny } } : {}),
  });
  return { api, created };
}
