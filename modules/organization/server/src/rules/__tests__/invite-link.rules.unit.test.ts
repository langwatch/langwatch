import { describe, expect, it } from "vitest";
import {
  buildAccessSettingsUrl,
  buildInviteAcceptUrl,
  buildMembersSettingsUrl,
} from "../invite-link.rules.ts";

describe("invite link rules", () => {
  const baseHost = "https://app.langwatch.ai";

  describe("buildInviteAcceptUrl", () => {
    it("carries the invite code as a query parameter", () => {
      expect(buildInviteAcceptUrl(baseHost, "abc123")).toBe(
        "https://app.langwatch.ai/invite/accept?inviteCode=abc123",
      );
    });

    it("encodes a code that needs it", () => {
      expect(buildInviteAcceptUrl(baseHost, "a b/c")).toBe(
        "https://app.langwatch.ai/invite/accept?inviteCode=a%20b%2Fc",
      );
    });
  });

  describe("buildMembersSettingsUrl", () => {
    it("names the members settings page, carrying no invite state", () => {
      expect(buildMembersSettingsUrl(baseHost)).toBe("https://app.langwatch.ai/settings/members");
    });
  });

  describe("buildAccessSettingsUrl", () => {
    it("names the access settings page and carries no verification secret", () => {
      const url = buildAccessSettingsUrl(baseHost);
      expect(url).toBe("https://app.langwatch.ai/settings/access");
      expect(url).not.toContain("?");
    });
  });
});
