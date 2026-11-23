import { describe, expect, it } from "vitest";

import { ContentSecurityPolicy } from "../content-security-policy.ts";
import { browserBundleDefaults, restSurfaceDefaults, trpcSurfaceDefaults } from "../defaults.ts";

describe("given the chart sandbox ships its own frame policy", () => {
  describe("when the app's own policy is built", () => {
    /** @scenario "The app's own policy is unchanged by the sandbox" */
    it("does not admit unpkg.com or esm.sh into the app's script-src", () => {
      const scriptSrc = ContentSecurityPolicy.app()
        .value.split("; ")
        .find((directive) => directive.startsWith("script-src "));

      expect(scriptSrc).toBeDefined();
      expect(scriptSrc).not.toMatch(/unpkg\.com|esm\.sh/);
    });
  });
});

describe("given a production response from the app's browser bundle", () => {
  const headers = browserBundleDefaults({ production: true });
  const directive = (name: string) =>
    headers
      .read("Content-Security-Policy")
      ?.split("; ")
      .find((candidate) => candidate.startsWith(`${name} `))
      ?.split(" ")
      .slice(1) ?? [];

  describe("when the voice panel's permissions and connections are read", () => {
    /** @scenario "The app's own headers allow the microphone and the ElevenLabs socket" */
    it("allows the microphone for the app's own origin and connects to the ElevenLabs API and socket", () => {
      expect(headers.read("Permissions-Policy")).toContain("microphone=(self)");
      expect(directive("connect-src")).toEqual(
        expect.arrayContaining(["https://api.elevenlabs.io", "wss://api.elevenlabs.io"]),
      );
    });
  });

  describe("when the ElevenLabs client registers its audio worklets from a blob: URL", () => {
    /** @scenario "The app's own headers allow the ElevenLabs audio worklets" */
    it("admits blob: in script-src, which an AudioWorklet module fetch is governed by", () => {
      expect(directive("script-src")).toContain("blob:");
    });
  });
});

describe("given a development response from the app's browser bundle", () => {
  const development = browserBundleDefaults({ production: false });
  const production = browserBundleDefaults({ production: true });

  describe("when the policy headers are read", () => {
    /** @scenario "Development responses report the production CSP without enforcing it" */
    it("carries the production policy as report-only and enforces none", () => {
      const enforced = production.read("Content-Security-Policy");

      expect(development.read("Content-Security-Policy")).toBeUndefined();
      expect(development.read("Content-Security-Policy-Report-Only")).toBe(
        enforced?.replace("; upgrade-insecure-requests", ""),
      );
      expect(production.read("Content-Security-Policy-Report-Only")).toBeUndefined();
    });
  });
});

describe("given a production deployment and its public address", () => {
  const upgrades = (headers: ReturnType<typeof browserBundleDefaults>) =>
    (headers.read("Content-Security-Policy") ?? "").includes("upgrade-insecure-requests");

  describe("when the public address is https", () => {
    /** @scenario "An HTTPS production install forces HTTPS on the browser" */
    it("keeps upgrade-insecure-requests and HSTS", () => {
      const headers = browserBundleDefaults({
        production: true,
        publicBaseUrl: "https://langwatch.example.com",
      });

      expect(upgrades(headers)).toBe(true);
      expect(headers.read("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    });
  });

  describe("when no public address is configured", () => {
    it("keeps upgrade-insecure-requests and HSTS", () => {
      const headers = browserBundleDefaults({ production: true });

      expect(upgrades(headers)).toBe(true);
      expect(headers.read("Strict-Transport-Security")).toBeDefined();
    });
  });

  describe("when the public address cannot be parsed as a URL", () => {
    it("keeps upgrade-insecure-requests and HSTS", () => {
      const headers = browserBundleDefaults({
        production: true,
        publicBaseUrl: "langwatch.internal",
      });

      expect(upgrades(headers)).toBe(true);
      expect(headers.read("Strict-Transport-Security")).toBeDefined();
    });
  });

  describe("when the public address is plain http on a host other than localhost", () => {
    /** @scenario "A self-hosted install over plain HTTP is not forced onto HTTPS" */
    it("drops upgrade-insecure-requests and HSTS, still enforcing the rest of the policy", () => {
      const headers = browserBundleDefaults({
        production: true,
        publicBaseUrl: "http://langwatch.internal:5560",
      });

      expect(upgrades(headers)).toBe(false);
      expect(headers.read("Strict-Transport-Security")).toBeUndefined();
      expect(headers.read("Content-Security-Policy")).toContain("default-src");
      expect(headers.read("Content-Security-Policy-Report-Only")).toBeUndefined();
    });

    it("drops HSTS from the tRPC and REST surfaces too", () => {
      const options = { production: true, publicBaseUrl: "http://langwatch.internal:5560" };

      expect(trpcSurfaceDefaults(options).read("Strict-Transport-Security")).toBeUndefined();
      expect(restSurfaceDefaults(options).read("Strict-Transport-Security")).toBeUndefined();
    });
  });

  describe("when the deployment runs in development over an https address", () => {
    it("sends neither, as before", () => {
      const headers = browserBundleDefaults({
        production: false,
        publicBaseUrl: "https://app.dev.langwatch.localhost",
      });

      expect(headers.read("Strict-Transport-Security")).toBeUndefined();
      expect(headers.read("Content-Security-Policy-Report-Only")).not.toContain(
        "upgrade-insecure-requests",
      );
    });
  });
});
