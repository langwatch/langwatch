import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseOutboundProxyConfig } from "~/server/outboundProxy";

const { buildMock, closeMock, createMock } = vi.hoisted(() => ({
  buildMock: vi.fn(() => ({ requestHandler: {} })),
  closeMock: vi.fn(() => Promise.resolve()),
  createMock: vi.fn(),
}));

vi.mock("@langwatch/aws-client", () => ({
  AwsClientConfiguration: {
    create: createMock.mockImplementation(() => ({ build: buildMock, close: closeMock })),
  },
  OutboundProxyResolverPort: class {},
}));

import {
  buildAwsClientConfig,
  closeAwsClientConfiguration,
  configureAwsClientConfiguration,
} from "../aws-client.composition";

const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
] as const;

const originalProxyEnv = Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));

function outboundProxy(): { tryResolveForHost(hostname: string): string | undefined } {
  const options = createMock.mock.calls[0]?.[0] as {
    outboundProxy: { tryResolveForHost(hostname: string): string | undefined };
  };
  return options.outboundProxy;
}

function deferredPromise(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: () => {
      if (!resolvePromise) throw new Error("Deferred promise was not initialised");
      resolvePromise();
    },
  };
}

describe("AWS client composition", () => {
  beforeEach(async () => {
    await closeAwsClientConfiguration();
    buildMock.mockClear();
    closeMock.mockClear();
    createMock.mockClear();
    for (const key of PROXY_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalProxyEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("injects the platform proxy resolver into the reusable AWS client", () => {
    process.env.HTTPS_PROXY = "http://proxy.corp:8080";
    process.env.NO_PROXY = ".internal.corp";

    configureAwsClientConfiguration(parseOutboundProxyConfig(process.env));
    buildAwsClientConfig({ targetHost: "email.eu-central-1.amazonaws.com" });

    expect(buildMock).toHaveBeenCalledWith({ targetHost: "email.eu-central-1.amazonaws.com" });
    expect(outboundProxy().tryResolveForHost("email.eu-central-1.amazonaws.com")).toBe(
      "http://proxy.corp:8080",
    );
    expect(outboundProxy().tryResolveForHost("mail-relay.internal.corp")).toBeUndefined();
  });

  it("closes one configuration then composes a fresh graph", async () => {
    configureAwsClientConfiguration({});

    const closing = closeAwsClientConfiguration();
    expect(closing).toBe(closeMock.mock.results[0]?.value);
    expect(() => buildAwsClientConfig({ targetHost: "sqs.eu-central-1.amazonaws.com" })).toThrow(
      "has not been composed",
    );

    await closing;
    configureAwsClientConfiguration({});
    buildAwsClientConfig({ targetHost: "sqs.eu-central-1.amazonaws.com" });

    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("keeps reconfiguration behind one pending teardown", async () => {
    const teardown = deferredPromise();
    closeMock.mockImplementationOnce(() => teardown.promise);
    configureAwsClientConfiguration({});

    const firstClose = closeAwsClientConfiguration();
    const repeatedClose = closeAwsClientConfiguration();

    expect(firstClose).toBe(teardown.promise);
    expect(repeatedClose).toBe(firstClose);
    expect(() => configureAwsClientConfiguration({})).toThrow("is closing");

    teardown.resolve();
    await firstClose;
    configureAwsClientConfiguration({});

    expect(closeMock).toHaveBeenCalledOnce();
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});
