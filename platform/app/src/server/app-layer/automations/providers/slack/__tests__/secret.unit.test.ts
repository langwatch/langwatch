import { describe, expect, it, vi } from "vitest";

// Fake cipher so the test exercises the secret module's orchestration
// (encrypt-on-new / keep-on-blank / redact / decrypt), not AES itself.
vi.mock("~/utils/encryption", () => ({
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) => s.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

import { SLACK_BOT_TOKEN_KEPT } from "@langwatch/automations/providers/slack";
import {
  decryptSlackBotToken,
  persistSlackActionParams,
  redactSlackActionParams,
} from "../server";

describe("persistSlackActionParams", () => {
  describe("when the params point at a connection", () => {
    it("stores only the id, the method and a bot connection's channel", () => {
      const stored = persistSlackActionParams({
        incoming: {
          slackIntegrationId: "conn-1",
          slackDelivery: "bot",
          slackChannelId: " C1 ",
          slackBotToken: "xoxb-leaked",
          slackWebhook: "https://hooks.slack.com/x",
        },
      });
      expect(stored).toEqual({
        slackIntegrationId: "conn-1",
        slackDelivery: "bot",
        slackChannelId: "C1",
      });
      // `toEqual` treats an absent key and an explicit `undefined` alike, so
      // the absence needs its own assertion to mean anything.
      expect(stored).not.toHaveProperty("slackBotToken");
    });
  });

  describe("when the kept sentinel arrives on a row that already has one", () => {
    it("keeps the stored ciphertext", () => {
      expect(
        persistSlackActionParams({
          incoming: {
            slackDelivery: "bot",
            slackChannelId: "C1",
            slackBotToken: SLACK_BOT_TOKEN_KEPT,
          },
          existing: { slackDelivery: "bot", slackBotToken: "enc(xoxb-old)" },
        }).slackBotToken,
      ).toBe("enc(xoxb-old)");
    });
  });

  it("keeps only the webhook in webhook mode (no stale bot fields)", () => {
    expect(
      persistSlackActionParams({
        incoming: {
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/x",
          slackBotToken: "leaked",
          slackChannelId: "C1",
        },
      }),
    ).toEqual({
      slackDelivery: "webhook",
      slackWebhook: "https://hooks.slack.com/x",
    });
  });

  it("encrypts a freshly-entered bot token", () => {
    expect(
      persistSlackActionParams({
        incoming: {
          slackDelivery: "bot",
          slackChannelId: "C1",
          slackBotToken: "xoxb-new",
        },
      }),
    ).toEqual({
      slackDelivery: "bot",
      slackChannelId: "C1",
      slackBotToken: "enc(xoxb-new)",
    });
  });

  /** @scenario "Editing a bot automation without re-entering the token" */
  it("keeps the stored ciphertext when the token is left blank on edit", () => {
    expect(
      persistSlackActionParams({
        incoming: { slackDelivery: "bot", slackChannelId: "C1" },
        existing: { slackDelivery: "bot", slackBotToken: "enc(xoxb-old)" },
      }).slackBotToken,
    ).toBe("enc(xoxb-old)");
  });

  it("routes the token through encrypt() before persisting (never raw)", () => {
    // The fake cipher wraps as enc(…); a raw token would be stored verbatim.
    // The real no-plaintext guarantee is AES in encryption.ts — here we assert
    // the token was handed to the cipher rather than stored as-is.
    const out = persistSlackActionParams({
      incoming: {
        slackDelivery: "bot",
        slackChannelId: "C1",
        slackBotToken: "xoxb-secret",
      },
    });
    expect(out.slackBotToken).toBe("enc(xoxb-secret)");
    expect(out.slackBotToken).not.toBe("xoxb-secret");
  });
});

describe("redactSlackActionParams", () => {
  it("drops a migrated row's legacy secrets once it points at a connection", () => {
    expect(
      redactSlackActionParams({
        slackIntegrationId: "conn-1",
        slackDelivery: "webhook",
        slackWebhook: "https://hooks.slack.com/x",
        slackBotToken: "enc(xoxb-old)",
      }),
    ).toEqual({ slackIntegrationId: "conn-1", slackDelivery: "webhook" });
  });

  it("replaces the ciphertext with a set flag", () => {
    expect(
      redactSlackActionParams({
        slackDelivery: "bot",
        slackChannelId: "C1",
        slackBotToken: "enc(xoxb)",
      }),
    ).toEqual({
      slackDelivery: "bot",
      slackChannelId: "C1",
      slackBotTokenSet: true,
    });
  });

  it("passes webhook params through untouched", () => {
    const params = {
      slackDelivery: "webhook" as const,
      slackWebhook: "https://x",
    };
    expect(redactSlackActionParams(params)).toEqual(params);
  });
});

describe("decryptSlackBotToken", () => {
  it("decrypts the stored token", () => {
    expect(decryptSlackBotToken({ slackBotToken: "enc(xoxb-live)" })).toBe(
      "xoxb-live",
    );
  });

  it("returns null when no token is stored", () => {
    expect(decryptSlackBotToken({})).toBeNull();
  });
});
