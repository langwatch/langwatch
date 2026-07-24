import { describe, expect, it } from "vitest";
import { SLACK_APP_MANIFEST } from "../client";

describe("Slack app manifest", () => {
  describe("given the copy-paste manifest for \"Create app → From a manifest\"", () => {
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
    });
  });
});
