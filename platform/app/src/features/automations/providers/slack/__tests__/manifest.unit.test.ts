import { describe, expect, it } from "vitest";
import { SLACK_APP_MANIFEST } from "../slackAppManifest";

describe("Slack app manifest", () => {
  describe('given the copy-paste manifest for "Create app → From a manifest"', () => {
    describe("when validating the manifest", () => {
      it("declares a bot_user alongside the bot oauth scopes", () => {
        expect(SLACK_APP_MANIFEST).toMatch(/scopes:\s*\n\s*bot:/);
        expect(SLACK_APP_MANIFEST).toMatch(
          /features:\s*\n\s*bot_user:\s*\n\s*display_name:\s*LangWatch\s*\n\s*always_online:\s*false/,
        );
      });

      it("orders bot_user before oauth_config so Slack sees the feature first", () => {
        const featuresIndex = SLACK_APP_MANIFEST.indexOf("features:");
        const oauthIndex = SLACK_APP_MANIFEST.indexOf("oauth_config:");
        expect(featuresIndex).toBeGreaterThan(-1);
        expect(featuresIndex).toBeLessThan(oauthIndex);
      });

      // The two Slack Web API calls the delivery layer actually makes
      // (`server/app-layer/automations/delivery/slackWebApi.ts`):
      // `chat.postMessage` (chat:write, chat:write.public for channels the
      // bot hasn't been invited to) and `conversations.list`
      // (channels:read for public channels, groups:read for private ones).
      // A scope missing here is a setup step the copy-paste manifest silently
      // fails to grant.
      it("grants every scope chat.postMessage and conversations.list need", () => {
        for (const scope of [
          "chat:write",
          "chat:write.public",
          "channels:read",
          "groups:read",
        ]) {
          // Anchored as a whole list item: a bare substring check on
          // "chat:write" could never fail while "chat:write.public" exists.
          expect(SLACK_APP_MANIFEST).toMatch(
            new RegExp(`-\\s+${scope.replace(/\\./g, "\\\\.")}\\s*$`, "m"),
          );
        }
      });
    });
  });
});
