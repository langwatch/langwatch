import { describe, expect, it, vi } from "vitest";

// Fake cipher: the resolution ORDER is what these tests pin, not AES.
vi.mock("~/utils/encryption", () => ({
  encrypt: (value: string) => `enc(${value})`,
  decrypt: (value: string) => value.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

import type { HandledError } from "@langwatch/handled-error";
import {
  findSlackBotToken,
  resolveSlackBotToken,
  type SlackProjectTokenReader,
  slackTokenMissingDispatchError,
} from "../slack-token-resolver";

const projectWith = (token: string | null): SlackProjectTokenReader => ({
  getBotToken: async () => token,
});

describe("resolveSlackBotToken", () => {
  describe("given an automation that stores its own token", () => {
    describe("when the project also has an integration", () => {
      /** @scenario "A legacy automation keeps delivering with its own token" */
      it("keeps using the automation's own token", async () => {
        const resolved = await resolveSlackBotToken({
          actionParams: { slackBotToken: "enc(xoxb-automation)" },
          projectId: "project-1",
          projectIntegration: projectWith("xoxb-project"),
        });

        expect(resolved).toEqual({
          token: "xoxb-automation",
          source: "automation",
        });
      });
    });
  });

  describe("given an automation whose stored token was cleared", () => {
    describe("when the project has an integration", () => {
      /** @scenario "Switching a legacy automation to the project integration" */
      it("falls through to the project integration", async () => {
        const resolved = await resolveSlackBotToken({
          actionParams: {},
          projectId: "project-1",
          projectIntegration: projectWith("xoxb-project"),
        });

        expect(resolved).toEqual({
          token: "xoxb-project",
          source: "project_integration",
        });
      });
    });
  });

  describe("given no token in either place", () => {
    describe("when a delivery resolves its token", () => {
      /** @scenario "Slack delivery without any token fails with a named cause" */
      it("refuses with the integration-missing code", async () => {
        await expect(
          resolveSlackBotToken({
            actionParams: {},
            projectId: "project-1",
            projectIntegration: projectWith(null),
          }),
        ).rejects.toMatchObject({ code: "slack_integration_missing" });
      });
    });

    describe("when the refusal reaches the dispatch queue", () => {
      /** @scenario "Slack delivery without any token fails with a named cause" */
      it("dead-letters the dispatch rather than retrying it", () => {
        const error = slackTokenMissingDispatchError({
          triggerName: "Error spike",
        });

        expect(error.retryable).toBe(false);
        expect((error.cause as HandledError).code).toBe(
          "slack_integration_missing",
        );
      });
    });
  });
});

describe("findSlackBotToken", () => {
  describe("given no token in either place", () => {
    describe("when a degrading caller asks for one", () => {
      it("answers null so the caller can say so in its own words", async () => {
        expect(
          await findSlackBotToken({
            actionParams: {},
            projectId: "project-1",
            projectIntegration: projectWith(null),
          }),
        ).toBeNull();
      });
    });
  });
});
