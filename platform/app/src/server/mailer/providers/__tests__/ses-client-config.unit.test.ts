import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildAwsClientConfigMock, mockEnv } = vi.hoisted(() => ({
  buildAwsClientConfigMock: vi.fn(() => ({ requestHandler: {} })),
  mockEnv: {} as Record<string, unknown>,
}));

vi.mock("../../../../env.mjs", () => ({ env: mockEnv }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

vi.mock("~/runtime/app/aws-client.composition", () => ({
  buildAwsClientConfig: buildAwsClientConfigMock,
}));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: vi.fn(),
  SendEmailCommand: vi.fn(),
  SendRawEmailCommand: vi.fn(),
}));

import { buildSesClientConfig } from "../ses";

describe("buildSesClientConfig", () => {
  beforeEach(() => {
    buildAwsClientConfigMock.mockClear();
    for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  });

  it("uses the regional SES host when no endpoint override is configured", () => {
    mockEnv.AWS_REGION = "eu-central-1";

    buildSesClientConfig();

    expect(buildAwsClientConfigMock).toHaveBeenCalledWith({
      region: "eu-central-1",
      targetHost: "email.eu-central-1.amazonaws.com",
      endpoint: undefined,
    });
  });

  it("passes a custom endpoint as both the SDK endpoint and proxy target", () => {
    mockEnv.AWS_REGION = "eu-central-1";
    mockEnv.AWS_SES_ENDPOINT = "mail-relay.internal.corp:465";

    buildSesClientConfig();

    expect(buildAwsClientConfigMock).toHaveBeenCalledWith({
      region: "eu-central-1",
      targetHost: "mail-relay.internal.corp:465",
      endpoint: "mail-relay.internal.corp:465",
    });
  });
});
