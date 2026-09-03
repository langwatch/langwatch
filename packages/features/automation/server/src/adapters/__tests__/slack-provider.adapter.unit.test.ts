/**
 * What happens to a Slack bot token between the form and the database. It is
 * a customer credential with a Slack workspace behind it, so it is encrypted
 * on the way in, never handed back on the way out, and an author who edits an
 * automation without retyping it keeps the one already stored.
 */
import {
  MissingSlackBotTokenError,
  SLACK_BOT_TOKEN_KEPT,
  type SlackActionParams,
} from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";
import { SlackProviderAdapter, type AutomationSecretCrypto } from "../slack-provider.adapter";

/**
 * A stand-in cipher. It hex-encodes rather than wrapping, so a test asserting
 * the plaintext is absent from the stored row cannot pass on a fake whose
 * ciphertext still spells it out.
 */
function reversingCrypto(): AutomationSecretCrypto & { encrypted: string[] } {
  const encrypted: string[] = [];

  return {
    encrypted,
    encrypt(value: string): string {
      encrypted.push(value);
      return Buffer.from(value, "utf8").toString("hex");
    },
    decrypt(value: string): string {
      return Buffer.from(value, "hex").toString("utf8");
    },
  };
}

const BOT: SlackActionParams = {
  slackDelivery: "bot",
  slackChannelId: "C123",
  slackBotToken: "xoxb-plaintext",
};

describe("SlackProviderAdapter", () => {
  describe("given a Slack automation saved with a bot token", () => {
    describe("when the parameters are persisted", () => {
      /** @scenario "The bot token is protected at rest" */
      it("stores the ciphertext, never the token the author typed", () => {
        const crypto = reversingCrypto();

        const persisted = SlackProviderAdapter.create(crypto).persist({ incoming: BOT });

        expect(crypto.encrypted).toEqual(["xoxb-plaintext"]);
        expect(persisted.slackBotToken).toBe(
          Buffer.from("xoxb-plaintext", "utf8").toString("hex"),
        );
        expect(JSON.stringify(persisted)).not.toContain("xoxb-plaintext");
      });
    });

    describe("when the automation is read back for the browser", () => {
      /** @scenario "The bot token is protected at rest" */
      it("returns the fact a token is set, and no token", () => {
        const adapter = SlackProviderAdapter.create(reversingCrypto());

        const redacted = adapter.redact(adapter.persist({ incoming: BOT }));

        expect(redacted).not.toHaveProperty("slackBotToken");
        expect(redacted).toMatchObject({ slackBotTokenSet: true, slackChannelId: "C123" });
        expect(JSON.stringify(redacted)).not.toContain("xoxb");
      });
    });

    describe("when the author edits it and leaves the token blank", () => {
      /** @scenario "Editing a bot automation without re-entering the token" */
      it("keeps the stored token rather than encrypting an empty string", () => {
        const crypto = reversingCrypto();
        const adapter = SlackProviderAdapter.create(crypto);
        const existing = adapter.persist({ incoming: BOT });
        crypto.encrypted.length = 0;

        const kept = adapter.persist({
          incoming: { slackDelivery: "bot", slackChannelId: "C123" },
          existing,
        });
        const sentinel = adapter.persist({
          incoming: {
            slackDelivery: "bot",
            slackChannelId: "C123",
            slackBotToken: SLACK_BOT_TOKEN_KEPT,
          },
          existing,
        });

        expect(kept.slackBotToken).toBe(existing.slackBotToken);
        expect(sentinel.slackBotToken).toBe(existing.slackBotToken);
        expect(crypto.encrypted).toEqual([]);
        expect(adapter.tryDecrypt(kept)).toBe("xoxb-plaintext");
      });
    });
  });

  describe("given a new Slack automation set to the bot connection", () => {
    describe("when it carries no token at all", () => {
      /** @scenario "A bot automation is incomplete without a token and channel" */
      it("refuses the save by name", () => {
        const adapter = SlackProviderAdapter.create(reversingCrypto());
        const incoming: SlackActionParams = { slackDelivery: "bot", slackChannelId: "C123" };

        expect(adapter.tokenMissing({ incoming })).toBe(true);
        expect(() => adapter.assertToken(incoming, null)).toThrow(MissingSlackBotTokenError);
      });

      /** @scenario "A bot automation is incomplete without a token and channel" */
      it("accepts it once a token is present, whether typed now or already stored", () => {
        const adapter = SlackProviderAdapter.create(reversingCrypto());
        const existing = adapter.persist({ incoming: BOT });

        expect(() => adapter.assertToken(BOT, null)).not.toThrow();
        expect(() =>
          adapter.assertToken({ slackDelivery: "bot", slackChannelId: "C123" }, existing),
        ).not.toThrow();
      });
    });
  });

  describe("given a webhook automation", () => {
    describe("when the parameters are persisted", () => {
      /** @scenario "An automation delivers through an incoming webhook" */
      it("keeps only the webhook url, with no bot token to protect", () => {
        const crypto = reversingCrypto();

        const persisted = SlackProviderAdapter.create(crypto).persist({
          incoming: {
            slackDelivery: "webhook",
            slackWebhook: " https://hooks.slack.test/T/B/X ",
          },
        });

        expect(persisted).toEqual({
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.test/T/B/X",
        });
        expect(crypto.encrypted).toEqual([]);
      });
    });
  });
});
