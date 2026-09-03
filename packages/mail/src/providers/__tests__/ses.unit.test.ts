import { describe, expect, it } from "vitest";

import { buildSesClientConfig, type SesAwsClientConfiguration } from "../ses";

function fakeAws(): SesAwsClientConfiguration & {
  calls: Array<{ region?: string; targetHost: string; endpoint?: string }>;
} {
  const calls: Array<{ region?: string; targetHost: string; endpoint?: string }> = [];
  return {
    calls,
    build(input) {
      calls.push(input);
      return { region: input.region, endpoint: input.endpoint };
    },
  };
}

describe("buildSesClientConfig", () => {
  describe("given no endpoint override", () => {
    it("targets the public regional SES host", () => {
      const aws = fakeAws();
      buildSesClientConfig({
        configuration: { enabled: true, region: "eu-central-1" },
        aws,
      });
      expect(aws.calls[0]?.targetHost).toBe("email.eu-central-1.amazonaws.com");
    });
  });

  describe("given a custom SES endpoint", () => {
    /** @scenario "Operator overrides the SES endpoint" */
    it("targets the override instead of the public regional endpoint", () => {
      const aws = fakeAws();
      const config = buildSesClientConfig({
        configuration: {
          enabled: true,
          region: "eu-central-1",
          endpoint: "https://vpce-123.email.eu-central-1.vpce.amazonaws.com",
        },
        aws,
      });

      expect(aws.calls[0]?.targetHost).toBe(
        "https://vpce-123.email.eu-central-1.vpce.amazonaws.com",
      );
      expect(config.endpoint).toBe("https://vpce-123.email.eu-central-1.vpce.amazonaws.com");
    });
  });
});
