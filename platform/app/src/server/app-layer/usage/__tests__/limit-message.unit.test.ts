import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildLimitMessage } from "../limit-message";

vi.mock("~/env.mjs", () => ({
  env: {
    IS_SAAS: true,
    BASE_HOST: undefined,
  },
}));

const envMock = await vi.hoisted(async () => {
  const mod = await import("~/env.mjs");
  return mod.env as { IS_SAAS: boolean; BASE_HOST: string | undefined };
});

describe("buildLimitMessage", () => {
  beforeEach(() => {
    envMock.IS_SAAS = true;
    envMock.BASE_HOST = undefined;
  });

  /** @scenario Free-tier org on SaaS told to upgrade with correct unit */
  it("tells a free-tier SaaS org to upgrade with the events unit", () => {
    envMock.IS_SAAS = true;
    const message = buildLimitMessage({
      isFree: true,
      limit: 50000,
      usageUnit: "events",
    });
    expect(message).toContain("Free limit of 50000 events reached");
    expect(message).toContain(
      "upgrade your plan at https://app.langwatch.ai/settings/subscription",
    );
  });

  /** @scenario Free-tier org on self-hosted told to buy a license */
  it("tells a free-tier self-hosted org to buy a license at the configured base host", () => {
    envMock.IS_SAAS = false;
    envMock.BASE_HOST = "https://my-langwatch.example.com";
    const message = buildLimitMessage({
      isFree: true,
      limit: 50000,
      usageUnit: "events",
    });
    expect(message).toContain("Free limit of 50000 events reached");
    expect(message).toContain(
      "buy a license at https://my-langwatch.example.com/settings/license",
    );
  });

  /** @scenario Paid TIERED org on SaaS told to upgrade with traces unit */
  it("tells a paid SaaS org to upgrade with the traces unit", () => {
    envMock.IS_SAAS = true;
    const message = buildLimitMessage({
      isFree: false,
      limit: 10000,
      usageUnit: "traces",
    });
    expect(message).toContain("Monthly limit of 10000 traces reached");
    expect(message).toContain(
      "upgrade your plan at https://app.langwatch.ai/settings/subscription",
    );
  });

  /** @scenario Paid TIERED org on self-hosted told to buy a license */
  it("tells a paid self-hosted org to buy a license at the configured base host", () => {
    envMock.IS_SAAS = false;
    envMock.BASE_HOST = "https://my-langwatch.example.com";
    const message = buildLimitMessage({
      isFree: false,
      limit: 10000,
      usageUnit: "traces",
    });
    expect(message).toContain("Monthly limit of 10000 traces reached");
    expect(message).toContain(
      "buy a license at https://my-langwatch.example.com/settings/license",
    );
  });
});
