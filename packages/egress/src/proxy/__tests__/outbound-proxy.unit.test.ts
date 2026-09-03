import { describe, expect, it } from "vitest";

import { isProxyBypassed, resolveProxyForHost } from "../outbound-proxy";

describe("resolveProxyForHost", () => {
  describe("given an outbound proxy", () => {
    /** @scenario "Email egress follows the configured outbound proxy" */
    it("routes traffic to the target host through the configured proxy", () => {
      expect(
        resolveProxyForHost(
          { httpsProxy: "http://proxy.corp:8080" },
          "email.eu-central-1.amazonaws.com",
        ),
      ).toBe("http://proxy.corp:8080");
    });

    it("falls back to HTTP_PROXY when HTTPS_PROXY is absent", () => {
      expect(resolveProxyForHost({ httpProxy: "http://fallback.corp:3128" }, "some.host")).toBe(
        "http://fallback.corp:3128",
      );
    });
  });

  describe("given the target host is excluded from proxying", () => {
    /** @scenario "Hosts excluded from proxying are contacted directly" */
    it("does not resolve a proxy for a host listed in NO_PROXY", () => {
      expect(
        resolveProxyForHost(
          {
            httpsProxy: "http://proxy.corp:8080",
            noProxy: "email.eu-central-1.amazonaws.com",
          },
          "email.eu-central-1.amazonaws.com",
        ),
      ).toBeUndefined();
    });
  });
});

describe("isProxyBypassed", () => {
  it("matches a parent domain entry against a subdomain", () => {
    expect(isProxyBypassed({ noProxy: ".amazonaws.com" }, "email.eu-central-1.amazonaws.com")).toBe(
      true,
    );
    expect(isProxyBypassed({ noProxy: "amazonaws.com" }, "email.eu-central-1.amazonaws.com")).toBe(
      true,
    );
  });

  it("bypasses everything with a wildcard entry", () => {
    expect(isProxyBypassed({ noProxy: "*" }, "anything.example.com")).toBe(true);
  });

  it("ignores a port suffix on the target host", () => {
    expect(isProxyBypassed({ noProxy: "internal.corp" }, "internal.corp:465")).toBe(true);
  });

  it("leaves hosts that are not listed to be proxied", () => {
    expect(isProxyBypassed({ noProxy: "internal.corp,.example.com" }, "not-excluded.corp")).toBe(
      false,
    );
  });

  it("reports no bypass when NO_PROXY is unset", () => {
    expect(isProxyBypassed({}, "any.host")).toBe(false);
  });
});
