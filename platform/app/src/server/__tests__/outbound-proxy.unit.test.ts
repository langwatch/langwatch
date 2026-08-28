import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseOutboundProxyConfig, resolveProxyForHost } from "../outboundProxy";

const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
] as const;

const originalProxyEnv = Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));

describe("resolveProxyForHost", () => {
  beforeEach(() => {
    for (const key of PROXY_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalProxyEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("prefers HTTPS_PROXY, then falls back to HTTP_PROXY and lowercase names", () => {
    process.env.HTTPS_PROXY = "http://https-proxy.corp:8080";
    process.env.HTTP_PROXY = "http://http-proxy.corp:8080";
    expect(
      resolveProxyForHost(
        parseOutboundProxyConfig(process.env),
        "email.eu-central-1.amazonaws.com",
      ),
    ).toBe("http://https-proxy.corp:8080");

    delete process.env.HTTPS_PROXY;
    expect(
      resolveProxyForHost(
        parseOutboundProxyConfig(process.env),
        "email.eu-central-1.amazonaws.com",
      ),
    ).toBe("http://http-proxy.corp:8080");

    delete process.env.HTTP_PROXY;
    process.env.https_proxy = "http://lowercase-proxy.corp:8080";
    expect(
      resolveProxyForHost(
        parseOutboundProxyConfig(process.env),
        "email.eu-central-1.amazonaws.com",
      ),
    ).toBe("http://lowercase-proxy.corp:8080");
  });

  it.each(["email.eu-central-1.amazonaws.com", ".amazonaws.com", "*"])(
    "bypasses the proxy for NO_PROXY entry %s",
    (noProxy) => {
      process.env.HTTPS_PROXY = "http://proxy.corp:8080";
      process.env.NO_PROXY = noProxy;

      expect(
        resolveProxyForHost(
          parseOutboundProxyConfig(process.env),
          "email.eu-central-1.amazonaws.com",
        ),
      ).toBeUndefined();
    },
  );

  it("proxies a host that is not excluded", () => {
    process.env.HTTPS_PROXY = "http://proxy.corp:8080";
    process.env.NO_PROXY = "internal.corp,.example.com";

    expect(
      resolveProxyForHost(
        parseOutboundProxyConfig(process.env),
        "email.eu-central-1.amazonaws.com",
      ),
    ).toBe("http://proxy.corp:8080");
  });
});
