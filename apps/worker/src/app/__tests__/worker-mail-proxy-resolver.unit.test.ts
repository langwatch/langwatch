/**
 * The worker mail graph's outbound-proxy bypass rules: SES traffic follows
 * the process's configured HTTPS/HTTP proxy, except for a host `NO_PROXY`
 * names.
 *
 * Spec: specs/ops/email-providers.feature
 */
import { describe, expect, it } from "vitest";

import { WorkerMailProxyResolver } from "../worker-mail.composition";

describe("WorkerMailProxyResolver", () => {
  describe("given an outbound proxy", () => {
    /** @scenario "Email egress follows the configured outbound proxy" */
    it("resolves the configured proxy for the SES host", () => {
      const resolver = WorkerMailProxyResolver.create({
        https: "http://proxy.corp:8080",
      });

      expect(resolver.tryResolveForHost("email.eu-central-1.amazonaws.com")).toBe(
        "http://proxy.corp:8080",
      );
    });

    it("falls back to the http proxy when no https proxy is configured", () => {
      const resolver = WorkerMailProxyResolver.create({
        http: "http://fallback.corp:3128",
      });

      expect(resolver.tryResolveForHost("email.eu-central-1.amazonaws.com")).toBe(
        "http://fallback.corp:3128",
      );
    });
  });

  describe("given the SES host is excluded from proxying", () => {
    /** @scenario "Hosts excluded from proxying are contacted directly" */
    it("resolves no proxy when the regional host is listed in NO_PROXY", () => {
      const resolver = WorkerMailProxyResolver.create({
        https: "http://proxy.corp:8080",
        noProxy: "email.eu-central-1.amazonaws.com",
      });

      expect(resolver.tryResolveForHost("email.eu-central-1.amazonaws.com")).toBeUndefined();
    });

    it("resolves no proxy when a parent domain is listed", () => {
      const resolver = WorkerMailProxyResolver.create({
        https: "http://proxy.corp:8080",
        noProxy: ".amazonaws.com",
      });

      expect(resolver.tryResolveForHost("email.eu-central-1.amazonaws.com")).toBeUndefined();
    });

    it("resolves no proxy when proxying is disabled with a wildcard", () => {
      const resolver = WorkerMailProxyResolver.create({
        https: "http://proxy.corp:8080",
        noProxy: "*",
      });

      expect(resolver.tryResolveForHost("email.eu-central-1.amazonaws.com")).toBeUndefined();
    });

    it("still proxies hosts that are not excluded", () => {
      const resolver = WorkerMailProxyResolver.create({
        https: "http://not-excluded.corp:8080",
        noProxy: "internal.corp,.example.com",
      });

      expect(resolver.tryResolveForHost("email.eu-central-1.amazonaws.com")).toBe(
        "http://not-excluded.corp:8080",
      );
    });
  });
});
