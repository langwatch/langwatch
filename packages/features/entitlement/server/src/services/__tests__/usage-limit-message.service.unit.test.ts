import { describe, expect, it } from "vitest";
import { buildLimitMessage, type UsageDeployment } from "../usage-limit-message.service";

const saas: UsageDeployment = { isSaas: true, baseHost: undefined };
const selfHosted: UsageDeployment = {
  isSaas: false,
  baseHost: "https://my-langwatch.example.com",
};

describe("buildLimitMessage", () => {
  /** @scenario Free-tier org on SaaS told to upgrade with correct unit */
  it("tells a free-tier SaaS org to upgrade with the events unit", () => {
    const message = buildLimitMessage({
      isFree: true,
      limit: 50000,
      usageUnit: "events",
      deployment: saas,
    });
    expect(message).toContain("Free limit of 50000 events reached");
    expect(message).toContain(
      "upgrade your plan at https://app.langwatch.ai/settings/subscription",
    );
  });

  /** @scenario Free-tier org on self-hosted told to buy a license */
  it("tells a free-tier self-hosted org to buy a license at the configured base host", () => {
    const message = buildLimitMessage({
      isFree: true,
      limit: 50000,
      usageUnit: "events",
      deployment: selfHosted,
    });
    expect(message).toContain("Free limit of 50000 events reached");
    expect(message).toContain(
      "buy a license at https://my-langwatch.example.com/settings/license",
    );
  });

  /** @scenario Paid TIERED org on SaaS told to upgrade with traces unit */
  it("tells a paid SaaS org to upgrade with the traces unit", () => {
    const message = buildLimitMessage({
      isFree: false,
      limit: 10000,
      usageUnit: "traces",
      deployment: saas,
    });
    expect(message).toContain("Monthly limit of 10000 traces reached");
    expect(message).toContain(
      "upgrade your plan at https://app.langwatch.ai/settings/subscription",
    );
  });

  /** @scenario Paid TIERED org on self-hosted told to buy a license */
  it("tells a paid self-hosted org to buy a license at the configured base host", () => {
    const message = buildLimitMessage({
      isFree: false,
      limit: 10000,
      usageUnit: "traces",
      deployment: selfHosted,
    });
    expect(message).toContain("Monthly limit of 10000 traces reached");
    expect(message).toContain(
      "buy a license at https://my-langwatch.example.com/settings/license",
    );
  });
});
