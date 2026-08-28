import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { buildMock, closeMock, createMock, mockEnv } = vi.hoisted(() => {
  const mockEnv: Record<string, string | void> = {};
  const buildMock = vi.fn(() => ({
    requestHandler: {
      destroy() {},
      handle() {
        return Promise.resolve();
      },
      metadata: {
        handlerProtocol: "http/1.1",
      },
    },
  }));
  const closeMock = vi.fn(() => Promise.resolve());
  const createMock = vi.fn(() => ({ build: buildMock, close: closeMock }));

  return { buildMock, closeMock, createMock, mockEnv };
});

vi.mock("../../../../env.mjs", () => ({
  env: mockEnv,
}));

vi.mock("@langwatch/aws-client", () => ({
  AwsClientConfiguration: {
    create: createMock,
  },
  OutboundProxyResolverPort: class OutboundProxyResolverPort {},
}));

import {
  buildAwsClientConfig,
  closeAwsClientConfiguration,
  configureAwsClientConfiguration,
} from "../../../../runtime/app/aws-client.composition";
import { buildSesClientConfig } from "../ses";

describe("SES AWS client composition", () => {
  beforeEach(async () => {
    await closeAwsClientConfiguration();
    buildMock.mockClear();
    closeMock.mockClear();
    createMock.mockClear();
    mockEnv.AWS_REGION = "us-east-1";
  });

  afterEach(async () => {
    await closeAwsClientConfiguration();
  });

  it("uses the package-provided borrowed handler views for each SES client", () => {
    configureAwsClientConfiguration({});

    const first = buildSesClientConfig();
    const second = buildSesClientConfig();

    expect(first.requestHandler).not.toBe(second.requestHandler);
    expect(first.requestHandler.metadata).toEqual({ handlerProtocol: "http/1.1" });
    expect(second.requestHandler.metadata).toEqual({ handlerProtocol: "http/1.1" });
    expect(buildMock).toHaveBeenNthCalledWith(1, {
      region: "us-east-1",
      targetHost: "email.us-east-1.amazonaws.com",
    });
    expect(buildMock).toHaveBeenNthCalledWith(2, {
      region: "us-east-1",
      targetHost: "email.us-east-1.amazonaws.com",
    });
  });

  it("keeps client handler disposal separate from process-owned configuration close", async () => {
    configureAwsClientConfiguration({});

    const clientConfig = buildSesClientConfig();
    clientConfig.requestHandler.destroy();

    expect(closeMock).not.toHaveBeenCalled();

    const close = closeAwsClientConfiguration();

    expect(close).toBe(closeMock.mock.results[0]?.value);

    await close;

    expect(closeMock).toHaveBeenCalledOnce();
    expect(() => buildAwsClientConfig({ targetHost: "email.us-east-1.amazonaws.com" })).toThrow(
      "has not been composed",
    );
  });
});
