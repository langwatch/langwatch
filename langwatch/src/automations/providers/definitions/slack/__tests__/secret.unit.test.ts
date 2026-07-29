import { describe, expect, it, vi } from "vitest";

// Fake cipher so the test exercises the secret module's orchestration
// (encrypt-on-new / keep-on-blank / redact / decrypt), not AES itself.
vi.mock("~/utils/encryption", () => ({
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) => s.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

import { SLACK_BOT_TOKEN_KEPT } from "../shared";
import {
  decryptSlackBotToken,
  persistSlackActionParams,
  redactSlackActionParams,
  slackBotTokenMissing,
} from "../secret";

describe("slackBotTokenMissing", () => {
  it("is false for webhook mode", () => {
    expect(
      slackBotTokenMissing({
        incoming: { slackDelivery: "webhook", slackWebhook: "https://x" },
      }),
    ).toBe(false);
  });

  it("is true for a bot connection with neither a new nor a stored token", () => {
    expect(
      slackBotTokenMissing({
        incoming: { slackDelivery: "bot", slackChannelId: "C1" },
      }),
    ).toBe(true);
  });

  it("is false when a new token is supplied", () => {
    expect(
      slackBotTokenMissing({
        incoming: {
          slackDelivery: "bot",
          slackChannelId: "C1",
          slackBotToken: "xoxb-new",
        },
      }),
    ).toBe(false);
  });

  it("is false when the token is kept and one is already stored", () => {
    expect(
      slackBotTokenMissing({
        incoming: {
          slackDelivery: "bot",
          slackChannelId: "C1",
          slackBotToken: SLACK_BOT_TOKEN_KEPT,
        },
        existing: { slackDelivery: "bot", slackBotToken: "enc(xoxb-old)" },
      }),
    ).toBe(false);
  });
});

describe("persistSlackActionParams", () => {
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
    const params = { slackDelivery: "webhook" as const, slackWebhook: "https://x" };
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
