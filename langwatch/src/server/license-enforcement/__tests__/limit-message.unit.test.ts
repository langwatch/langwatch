import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({
  env: {
    IS_SAAS: false,
    BASE_HOST: "https://app.langwatch.ai",
  },
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { env } from "~/env.mjs";
import { buildMessagePrefix, buildUpgradeAction } from "../limit-message";

describe("buildMessagePrefix", () => {
  it("returns 'Free plan' for free planSource", () => {
    expect(buildMessagePrefix("free")).toBe("Free plan");
  });

  it("returns 'Plan' for subscription planSource", () => {
    expect(buildMessagePrefix("subscription")).toBe("Plan");
  });

  it("returns 'License' for license planSource", () => {
    expect(buildMessagePrefix("license")).toBe("License");
  });
});

describe("buildUpgradeAction", () => {
  beforeEach(() => {
    (env as { IS_SAAS: boolean }).IS_SAAS = false;
    (env as { BASE_HOST: string | undefined }).BASE_HOST =
      "https://app.langwatch.ai";
  });

  describe("on SaaS", () => {
    beforeEach(() => {
      (env as { IS_SAAS: boolean }).IS_SAAS = true;
    });

    /** @scenario "Free-tier org on SaaS told to upgrade with correct unit" */
    it("tells free-tier orgs to upgrade their plan at app.langwatch.ai", () => {
      const action = buildUpgradeAction("free");
      expect(action).toContain(
        "upgrade your plan at https://app.langwatch.ai/settings/subscription",
      );
    });

    /** @scenario "Paid TIERED org on SaaS told to upgrade with traces unit" */
    it("tells paid orgs to upgrade their plan at app.langwatch.ai", () => {
      const action = buildUpgradeAction("subscription");
      expect(action).toContain(
        "upgrade your plan at https://app.langwatch.ai/settings/subscription",
      );
    });
  });

  describe("on self-hosted", () => {
    beforeEach(() => {
      (env as { IS_SAAS: boolean }).IS_SAAS = false;
      (env as { BASE_HOST: string | undefined }).BASE_HOST =
        "https://my-langwatch.example.com";
    });

    /** @scenario "Free-tier org on self-hosted told to buy a license" */
    it("tells free-tier orgs to get a license at the configured BASE_HOST", () => {
      const action = buildUpgradeAction("free");
      expect(action).toContain(
        "get a license at https://my-langwatch.example.com/settings/license",
      );
    });

    /** @scenario "Paid TIERED org on self-hosted told to buy a license" */
    it("tells licensed orgs to upgrade their license at the configured BASE_HOST", () => {
      const action = buildUpgradeAction("license");
      expect(action).toContain(
        "upgrade your license at https://my-langwatch.example.com/settings/license",
      );
    });

    it("falls back to default app.langwatch.ai when BASE_HOST is missing", () => {
      (env as { BASE_HOST: string | undefined }).BASE_HOST = undefined;
      const action = buildUpgradeAction("free");
      expect(action).toContain(
        "get a license at https://app.langwatch.ai/settings/license",
      );
    });
  });
});
