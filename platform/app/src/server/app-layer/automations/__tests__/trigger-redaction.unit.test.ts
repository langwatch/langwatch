import { TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "~/utils/encryption";
import { decryptWebhookHeaders } from "../providers/webhook/server";
import {
  persistPublicApiActionParams,
  REDACTED_CREDENTIAL,
  redactTriggerForPublicApi,
  redactTriggerForRead,
} from "../trigger-redaction";

const SLACK_WEBHOOK =
  "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX";
const HEADER_VALUE = "Bearer sk-live-abcdefghijklmnop";
const SIGNING_SECRET = "whsec-abcdefghijklmnopqrstuvwxyz";

describe("redactTriggerForPublicApi", () => {
  describe("given a Slack automation", () => {
    it("replaces the incoming webhook URL with the placeholder", () => {
      const redacted = redactTriggerForPublicApi({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: { slackDelivery: "webhook", slackWebhook: SLACK_WEBHOOK },
      });

      expect(redacted.actionParams).toEqual({
        slackDelivery: "webhook",
        slackWebhook: REDACTED_CREDENTIAL,
      });
      expect(JSON.stringify(redacted)).not.toContain("hooks.slack.com");
    });

    it("keeps the stored bot token out and reports that one is set", () => {
      const redacted = redactTriggerForPublicApi({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "bot",
          slackChannelId: "C123",
          slackBotToken: "abc:def:ghi",
        },
      });

      expect(redacted.actionParams).toEqual({
        slackDelivery: "bot",
        slackChannelId: "C123",
        slackBotTokenSet: true,
      });
    });
  });

  describe("given a webhook automation with a stored header", () => {
    /** @scenario "The delivery shape survives redaction" */
    it("keeps the destination and header name, and hides the value", () => {
      const redacted = redactTriggerForPublicApi({
        action: TriggerAction.SEND_WEBHOOK,
        actionParams: {
          url: "https://example.com/hooks/langwatch",
          method: "POST",
          headers: { Authorization: HEADER_VALUE },
        },
      });

      expect(redacted.actionParams).toMatchObject({
        url: "https://example.com/hooks/langwatch",
        method: "POST",
        headers: { Authorization: REDACTED_CREDENTIAL },
      });
      expect(JSON.stringify(redacted)).not.toContain("sk-live");
    });

    it("reports an unsigned automation as unsigned rather than as a secret", () => {
      const redacted = redactTriggerForPublicApi({
        action: TriggerAction.SEND_WEBHOOK,
        actionParams: {
          url: "https://example.com/hooks/langwatch",
          headers: {},
        },
      });

      expect(
        (redacted.actionParams as unknown as { signingSecret: unknown })
          .signingSecret,
      ).toBeNull();
    });
  });

  describe("given an automation whose delivery carries no credential", () => {
    it("returns the delivery configuration unchanged", () => {
      const actionParams = { datasetId: "dataset_1" };

      expect(
        redactTriggerForPublicApi({
          action: TriggerAction.ADD_TO_DATASET,
          actionParams,
        }).actionParams,
      ).toEqual(actionParams);
    });
  });

  describe("given a webhook automation whose header is encrypted at rest", () => {
    it("keeps the header name and hides the value", () => {
      const redacted = redactTriggerForPublicApi({
        action: TriggerAction.SEND_WEBHOOK,
        actionParams: {
          url: "https://example.com/hooks/langwatch",
          headersEncrypted: encrypt(
            JSON.stringify({ Authorization: HEADER_VALUE }),
          ),
          signingSecretEncrypted: encrypt(SIGNING_SECRET),
        },
      });

      expect(redacted.actionParams).toMatchObject({
        url: "https://example.com/hooks/langwatch",
        headers: { Authorization: REDACTED_CREDENTIAL },
        signingSecret: REDACTED_CREDENTIAL,
      });
      const serialized = JSON.stringify(redacted);
      expect(serialized).not.toContain("sk-live");
      expect(serialized).not.toContain("whsec");
      expect(serialized).not.toContain("headersEncrypted");
    });
  });

  describe("given a stored row whose saved credentials cannot be read back", () => {
    /** @scenario "A delivery configuration that cannot be read comes back empty" */
    it("returns an empty delivery configuration and keeps the rest readable", () => {
      const redacted = redactTriggerForPublicApi({
        id: "trigger_1",
        action: TriggerAction.SEND_WEBHOOK,
        actionParams: {
          url: "https://example.com/hooks/langwatch",
          headersEncrypted: "not-something-this-server-can-read",
        },
      });

      expect(redacted.actionParams).toEqual({});
      expect(redacted.id).toBe("trigger_1");
    });
  });

  describe("given a stored row naming a channel this server does not offer", () => {
    /** @scenario "A delivery channel the server no longer offers returns nothing" */
    it("returns an empty delivery configuration", () => {
      const redacted = redactTriggerForPublicApi({
        action: "SEND_CARRIER_PIGEON" as TriggerAction,
        actionParams: { pigeonWebhook: SLACK_WEBHOOK },
      });

      expect(redacted.actionParams).toEqual({});
    });
  });

  describe("given the stored row", () => {
    it("leaves it untouched", () => {
      const actionParams = { slackWebhook: SLACK_WEBHOOK };

      redactTriggerForPublicApi({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams,
      });

      expect(actionParams.slackWebhook).toBe(SLACK_WEBHOOK);
    });
  });
});

describe("redactTriggerForRead", () => {
  describe("given a Slack automation the dashboard is about to edit", () => {
    it("keeps the fields the composer round-trips and drops the token", () => {
      const redacted = redactTriggerForRead({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: { slackWebhook: SLACK_WEBHOOK, slackBotToken: "cipher" },
      });

      expect(redacted.actionParams).toEqual({
        slackWebhook: SLACK_WEBHOOK,
        slackBotTokenSet: true,
      });
    });
  });
});

describe("persistPublicApiActionParams", () => {
  describe("given the read response written back for a customer endpoint", () => {
    it("keeps the stored header value and signing secret", async () => {
      const stored = {
        url: "https://example.com/hooks/langwatch",
        method: "POST",
        headersEncrypted: encrypt(
          JSON.stringify({ Authorization: HEADER_VALUE }),
        ),
        signingSecretEncrypted: encrypt(SIGNING_SECRET),
      };
      const read = redactTriggerForPublicApi({
        action: TriggerAction.SEND_WEBHOOK,
        actionParams: stored,
      });

      const saved = (await persistPublicApiActionParams({
        action: TriggerAction.SEND_WEBHOOK,
        incoming: read.actionParams,
        stored,
      })) as { headersEncrypted: string; signingSecretEncrypted: string };

      expect(decryptWebhookHeaders(saved)).toEqual({
        Authorization: HEADER_VALUE,
      });
      expect(decrypt(saved.signingSecretEncrypted)).toBe(SIGNING_SECRET);
    });
  });

  describe("given the read response written back for a Slack bot connection", () => {
    it("keeps the stored bot token", async () => {
      const stored = {
        slackDelivery: "bot",
        slackChannelId: "C123",
        slackBotToken: encrypt("xoxb-000000000000-abcdefghijkl"),
      };
      const read = redactTriggerForPublicApi({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: stored,
      });

      const saved = (await persistPublicApiActionParams({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        incoming: read.actionParams,
        stored,
      })) as { slackBotToken: string };

      expect(decrypt(saved.slackBotToken)).toBe(
        "xoxb-000000000000-abcdefghijkl",
      );
    });
  });

  describe("given the read response written back for a Slack incoming webhook", () => {
    it("keeps the stored webhook URL", async () => {
      const stored = { slackDelivery: "webhook", slackWebhook: SLACK_WEBHOOK };
      const read = redactTriggerForPublicApi({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: stored,
      });

      expect(
        await persistPublicApiActionParams({
          action: TriggerAction.SEND_SLACK_MESSAGE,
          incoming: read.actionParams,
          stored,
        }),
      ).toEqual(stored);
    });
  });

  describe("given a destination the caller typed", () => {
    it("saves what the caller typed", async () => {
      const typed = "https://hooks.slack.com/services/T1/B1/typed";

      expect(
        await persistPublicApiActionParams({
          action: TriggerAction.SEND_SLACK_MESSAGE,
          incoming: { slackDelivery: "webhook", slackWebhook: typed },
          stored: { slackDelivery: "webhook", slackWebhook: SLACK_WEBHOOK },
        }),
      ).toEqual({ slackDelivery: "webhook", slackWebhook: typed });
    });
  });

  describe("given a placeholder with nothing stored behind it", () => {
    // The placeholder stands for a credential the automation already has, so
    // with nothing stored it names no destination at all — and a channel with
    // no destination is a configuration it cannot use.
    it("refuses it rather than saving the placeholder", async () => {
      await expect(
        persistPublicApiActionParams({
          action: TriggerAction.SEND_SLACK_MESSAGE,
          incoming: {
            slackDelivery: "webhook",
            slackWebhook: REDACTED_CREDENTIAL,
          },
        }),
      ).rejects.toMatchObject({ code: "invalid_action_params" });
    });
  });

  describe("given a delivery configuration its channel cannot use", () => {
    it("refuses it and names the field at fault", async () => {
      await expect(
        persistPublicApiActionParams({
          action: TriggerAction.SEND_WEBHOOK,
          incoming: { url: "http://example.com/hooks/langwatch" },
        }),
      ).rejects.toMatchObject({
        code: "invalid_action_params",
        meta: { field: "url" },
      });
    });
  });

  describe("given an automation that fires on a rule the channel does not own", () => {
    it("carries the rule across while the channel states its own fields", async () => {
      const rule = {
        threshold: 5,
        operator: "gt",
        timePeriod: 60,
        seriesName: "Errors",
      };

      expect(
        await persistPublicApiActionParams({
          action: TriggerAction.SEND_SLACK_MESSAGE,
          incoming: {
            slackDelivery: "webhook",
            slackWebhook: SLACK_WEBHOOK,
            ...rule,
          },
        }),
      ).toEqual({
        ...rule,
        slackDelivery: "webhook",
        slackWebhook: SLACK_WEBHOOK,
      });
    });

    it("still lets the channel drop a credential from another delivery method", async () => {
      const saved = (await persistPublicApiActionParams({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        incoming: {
          slackDelivery: "webhook",
          slackWebhook: SLACK_WEBHOOK,
          slackChannelId: "C123",
          threshold: 5,
        },
      })) as Record<string, unknown>;

      expect(saved.slackChannelId).toBeUndefined();
      expect(saved.threshold).toBe(5);
    });
  });

  describe("given a delivery channel this server does not offer", () => {
    /** @scenario "A delivery channel the server no longer offers is written as it was sent" */
    it("stores what the caller sent", async () => {
      const actionParams = { pigeonWebhook: "https://example.com/pigeon" };

      expect(
        await persistPublicApiActionParams({
          action: "SEND_CARRIER_PIGEON" as TriggerAction,
          incoming: actionParams,
        }),
      ).toEqual(actionParams);
    });
  });

  describe("given a delivery that carries no credential", () => {
    it("stores what the caller sent", async () => {
      const actionParams = { members: ["someone@example.com"] };

      expect(
        await persistPublicApiActionParams({
          action: TriggerAction.SEND_EMAIL,
          incoming: actionParams,
        }),
      ).toEqual(actionParams);
    });
  });

  describe("given a payload naming a field another channel delivers by", () => {
    /** @scenario "Another channel's field never survives as part of the rule" */
    it("keeps it out of the rule the automation fires by", async () => {
      const saved = (await persistPublicApiActionParams({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        incoming: {
          slackDelivery: "webhook",
          slackWebhook: SLACK_WEBHOOK,
          // The webhook channel's, not Slack's. Read as delivery wherever it
          // turns up, it reaches Slack's own schema and is dropped there; read
          // as rule, it would sit in the row waiting for a channel that knows
          // what to do with it.
          headers: { Authorization: HEADER_VALUE },
          url: "https://example.com/hooks/langwatch",
        },
      })) as Record<string, unknown>;

      expect(saved.headers).toBeUndefined();
      expect(saved.url).toBeUndefined();
      expect(JSON.stringify(saved)).not.toContain(HEADER_VALUE);
    });

    /** @scenario "The rule an automation fires by still survives a save" */
    it("still carries the rule across", async () => {
      const saved = (await persistPublicApiActionParams({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        incoming: {
          slackDelivery: "webhook",
          slackWebhook: SLACK_WEBHOOK,
          threshold: 5,
          operator: "gt",
          timePeriod: 60,
          seriesName: "Errors",
        },
      })) as Record<string, unknown>;

      expect(saved).toMatchObject({
        threshold: 5,
        operator: "gt",
        timePeriod: 60,
        seriesName: "Errors",
      });
    });
  });

  describe("given a customer endpoint saved without any header", () => {
    it("stores the destination without inventing one", async () => {
      const saved = (await persistPublicApiActionParams({
        action: TriggerAction.SEND_WEBHOOK,
        incoming: { url: "https://example.com/hooks/langwatch" },
      })) as Record<string, unknown>;

      expect(saved.url).toBe("https://example.com/hooks/langwatch");
      expect(saved.headersEncrypted).toBeUndefined();
      expect(saved.signingSecretEncrypted).toBeUndefined();
    });
  });
});
