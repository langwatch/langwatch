import { describe, expect, it } from "vitest";

import { ContentSecurityPolicy } from "../content-security-policy.ts";
import { browserBundleDefaults } from "../defaults.ts";

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
