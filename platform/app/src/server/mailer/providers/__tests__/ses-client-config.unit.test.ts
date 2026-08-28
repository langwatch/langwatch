import { describe, expect, it, vi } from "vitest";
import { buildSesClientConfig } from "../ses";

const aws = { build: vi.fn(() => ({ requestHandler: {} })) };

describe("buildSesClientConfig", () => {
  it("uses the China SES host for the China AWS partition", () => {
    buildSesClientConfig({
      configuration: { enabled: true, region: "cn-north-1" },
      aws,
    });

    expect(aws.build).toHaveBeenCalledWith({
      region: "cn-north-1",
      targetHost: "email.cn-north-1.amazonaws.com.cn",
      endpoint: undefined,
    });
  });

  it("uses an endpoint override for both the SDK and proxy decision", () => {
    buildSesClientConfig({
      configuration: { enabled: true, region: "eu-central-1", endpoint: "mail-relay.internal:465" },
      aws,
    });

    expect(aws.build).toHaveBeenCalledWith({
      region: "eu-central-1",
      targetHost: "mail-relay.internal:465",
      endpoint: "mail-relay.internal:465",
    });
  });
});
