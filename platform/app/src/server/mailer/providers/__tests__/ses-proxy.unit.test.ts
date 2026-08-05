import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv, httpsProxyAgentMock, nodeHttpHandlerMock } = vi.hoisted(
  () => ({
    mockEnv: {} as Record<string, unknown>,
    httpsProxyAgentMock: vi.fn(function (this: { url: string }, url: string) {
      this.url = url;
    }),
    nodeHttpHandlerMock: vi.fn(function (
      this: { options: unknown },
      options: unknown,
    ) {
      this.options = options;
    }),
  }),
);

vi.mock("../../../../env.mjs", () => ({ env: mockEnv }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

vi.mock("https-proxy-agent", () => ({ HttpsProxyAgent: httpsProxyAgentMock }));

vi.mock("@smithy/node-http-handler", () => ({
  NodeHttpHandler: nodeHttpHandlerMock,
}));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: vi.fn(),
  SendEmailCommand: vi.fn(),
  SendRawEmailCommand: vi.fn(),
}));

import { buildSesClientConfig } from "../ses";

const setEnv = (values: Record<string, unknown>) => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  Object.assign(mockEnv, values);
};

// Both cases matter: the resolver reads either, so a suite that clears only
// the uppercase names would leak the lowercase ones into other test files.
const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
] as const;

const originalProxyEnv = Object.fromEntries(
  PROXY_ENV_KEYS.map((key) => [key, process.env[key]]),
);

const clearProxyEnv = () => {
  for (const key of PROXY_ENV_KEYS) delete process.env[key];
};

const restoreProxyEnv = () => {
  for (const [key, value] of Object.entries(originalProxyEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

describe("buildSesClientConfig", () => {
  beforeEach(() => {
    setEnv({ USE_AWS_SES: "true", AWS_REGION: "eu-central-1" });
    clearProxyEnv();
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreProxyEnv();
  });

  describe("given no proxy and no endpoint override", () => {
    it("configures only the region, as before", () => {
      const config = buildSesClientConfig();

      expect(config.region).toBe("eu-central-1");
      expect(config.endpoint).toBeUndefined();
      expect(config.requestHandler).toBeUndefined();
    });
  });

  describe("given an outbound proxy", () => {
    /** @scenario "Email egress follows the configured outbound proxy" */
    it("routes SES traffic through a proxy-aware request handler", () => {
      process.env.HTTPS_PROXY = "http://proxy.corp:8080";

      const config = buildSesClientConfig();

      expect(httpsProxyAgentMock).toHaveBeenCalledWith(
        "http://proxy.corp:8080",
      );
      expect(config.requestHandler).toBeDefined();
    });

    // A distinct URL per test: agents are cached per proxy URL, so reusing one
    // would mean no construction to observe here.
    it("uses the proxy agent for both http and https traffic", () => {
      process.env.HTTPS_PROXY = "http://both-schemes.corp:8080";

      buildSesClientConfig();

      const options = nodeHttpHandlerMock.mock.calls[0]?.[0] as {
        httpAgent: unknown;
        httpsAgent: unknown;
      };
      expect(options.httpAgent).toBeDefined();
      expect(options.httpsAgent).toBe(options.httpAgent);
    });

    it("reuses one agent per proxy url, so bursts do not leak socket pools", () => {
      process.env.HTTPS_PROXY = "http://reused.corp:8080";

      const first = buildSesClientConfig();
      const second = buildSesClientConfig();

      expect(second.requestHandler).toBe(first.requestHandler);
      expect(
        httpsProxyAgentMock.mock.calls.filter(
          ([url]) => url === "http://reused.corp:8080",
        ),
      ).toHaveLength(1);
    });

    it("falls back to HTTP_PROXY when HTTPS_PROXY is absent", () => {
      process.env.HTTP_PROXY = "http://fallback.corp:3128";

      buildSesClientConfig();

      expect(httpsProxyAgentMock).toHaveBeenCalledWith(
        "http://fallback.corp:3128",
      );
    });

    it("honours lowercase proxy variables", () => {
      process.env.https_proxy = "http://lower.corp:8080";

      buildSesClientConfig();

      expect(httpsProxyAgentMock).toHaveBeenCalledWith(
        "http://lower.corp:8080",
      );
    });
  });

  describe("given the SES host is excluded from proxying", () => {
    /** @scenario "Hosts excluded from proxying are contacted directly" */
    it("connects directly when the regional host is listed", () => {
      process.env.HTTPS_PROXY = "http://proxy.corp:8080";
      process.env.NO_PROXY = "email.eu-central-1.amazonaws.com";

      const config = buildSesClientConfig();

      expect(httpsProxyAgentMock).not.toHaveBeenCalled();
      expect(config.requestHandler).toBeUndefined();
    });

    it("connects directly when a parent domain is listed", () => {
      process.env.HTTPS_PROXY = "http://proxy.corp:8080";
      process.env.NO_PROXY = ".amazonaws.com";

      buildSesClientConfig();

      expect(httpsProxyAgentMock).not.toHaveBeenCalled();
    });

    it("connects directly when proxying is disabled with a wildcard", () => {
      process.env.HTTPS_PROXY = "http://proxy.corp:8080";
      process.env.NO_PROXY = "*";

      buildSesClientConfig();

      expect(httpsProxyAgentMock).not.toHaveBeenCalled();
    });

    it("still proxies hosts that are not excluded", () => {
      process.env.HTTPS_PROXY = "http://not-excluded.corp:8080";
      process.env.NO_PROXY = "internal.corp,.example.com";

      buildSesClientConfig();

      expect(httpsProxyAgentMock).toHaveBeenCalled();
    });
  });

  describe("given a custom SES endpoint", () => {
    /** @scenario "Operator overrides the SES endpoint" */
    it("targets the override instead of the public regional endpoint", () => {
      setEnv({
        USE_AWS_SES: "true",
        AWS_REGION: "eu-central-1",
        AWS_SES_ENDPOINT:
          "https://vpce-123.email.eu-central-1.vpce.amazonaws.com",
      });

      const config = buildSesClientConfig();

      expect(config.endpoint).toBe(
        "https://vpce-123.email.eu-central-1.vpce.amazonaws.com",
      );
    });

    it("evaluates proxy exclusions against the override host", () => {
      setEnv({
        USE_AWS_SES: "true",
        AWS_REGION: "eu-central-1",
        AWS_SES_ENDPOINT: "https://mail-relay.internal.corp",
      });
      process.env.HTTPS_PROXY = "http://proxy.corp:8080";
      process.env.NO_PROXY = "internal.corp";

      buildSesClientConfig();

      expect(httpsProxyAgentMock).not.toHaveBeenCalled();
    });

    it("evaluates proxy exclusions for an endpoint given without a scheme", () => {
      setEnv({
        USE_AWS_SES: "true",
        AWS_REGION: "eu-central-1",
        AWS_SES_ENDPOINT: "mail-relay.internal.corp:465",
      });
      process.env.HTTPS_PROXY = "http://proxy.corp:8080";
      process.env.NO_PROXY = "internal.corp";

      buildSesClientConfig();

      expect(httpsProxyAgentMock).not.toHaveBeenCalled();
    });
  });
});
