import { describe, expect, it } from "vitest";

import { judgeWebhookUrl } from "../webhook-url-policy.rules.ts";

/**
 * Admission matrix tested under both escape-hatch states to catch silent drift.
 * Spec: modules/webhook/specs/webhook-egress.feature
 */

const judge = (url: string, allowInsecureLocal = false) =>
  judgeWebhookUrl({ url, allowInsecureLocal });

const reasonOf = (url: string, allowInsecureLocal = false): string | null => {
  const verdict = judge(url, allowInsecureLocal);
  return verdict.admitted ? null : verdict.reason;
};

describe("the webhook URL admission policy", () => {
  describe("given the escape hatch is off, as every automation dispatch has it", () => {
    /** @scenario "Only https on the default port is admitted" */
    it("admits https on the default port and nothing else", () => {
      expect(judge("https://example.com/hooks/lw")).toEqual({ admitted: true });
      expect(judge("https://example.com:443/hooks/lw")).toEqual({ admitted: true });
      expect(reasonOf("http://example.com/x")).toContain("must use https");
      expect(reasonOf("ftp://example.com/x")).toContain("must use https");
      expect(reasonOf("not a url")).toContain("valid URL");
    });

    /** @scenario "Only https on the default port is admitted" */
    it("refuses a non-default port, which is what a port probe looks like", () => {
      expect(reasonOf("https://example.com:8443/x")).toContain("default https port");
      expect(reasonOf("https://internal:6379/x")).toContain("default https port");
    });

    /** @scenario "A URL carrying credentials is refused whatever else is relaxed" */
    it("refuses credentials in the URL", () => {
      expect(reasonOf("https://user:pass@example.com/x")).toContain("cannot carry credentials");
      expect(reasonOf("https://user@example.com/x")).toContain("cannot carry credentials");
    });
  });

  describe("given the escape hatch is on, as a self-hosted endpoints install has it", () => {
    /** @scenario "The escape hatch relaxes the origin and the local-address block, and nothing else" */
    it("admits plain http on a non-default port, which is what a local receiver needs", () => {
      expect(judge("http://localhost:4101/hook", true)).toEqual({ admitted: true });
      expect(judge("http://receiver.internal:8080/hook", true)).toEqual({ admitted: true });
    });

    /** @scenario "The escape hatch relaxes the origin and the local-address block, and nothing else" */
    it("still refuses a scheme that is neither http nor https", () => {
      expect(reasonOf("ftp://example.com/x", true)).toContain("must use https");
    });

    /** @scenario "A URL carrying credentials is refused whatever else is relaxed" */
    it("still refuses credentials, which no receiver ever needs", () => {
      expect(reasonOf("http://user:pass@localhost:4101/x", true)).toContain(
        "cannot carry credentials",
      );
    });
  });
});

describe("judgeWebhookUrl refusals", () => {
  describe("when the URL fails the shape check", () => {
    /** @scenario "Only https on the default port is admitted" */
    it("refuses, carrying the rule that was broken", () => {
      expect(reasonOf("https://example.com:8443/x")).toContain("443");
    });
  });

  describe("when the host is a private, loopback, link-local or metadata IP literal", () => {
    /** @scenario "A private or loopback address is refused terminally" */
    it.each([
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://172.16.0.1/hook",
      "https://192.168.1.1/hook",
      "https://169.254.169.254/hook",
      "https://0.0.0.0/hook",
      "https://100.64.0.1/hook",
    ])("refuses %s permanently rather than as a retryable DNS failure", (url) => {
      expect(reasonOf(url)).toMatch(/private or loopback/i);
    });

    /**
     * A URL's `hostname` keeps IPv6 in brackets, which the address classifier
     * rejects — so without this layer a `[::1]` reaches the validator as a
     * NAME, fails as unresolvable, and comes back RETRYABLE. The brackets are
     * stripped here so a loopback is the permanent refusal it is, and so the
     * IPv6 metadata endpoint is refused by address even though the metadata
     * host list never matches its bracketed spelling.
     */
    /** @scenario "A private or loopback address is refused terminally" */
    it.each(["https://[::1]/hook", "https://[fd00:ec2::254]/hook", "https://[fe80::1]/hook"])(
      "refuses %s permanently, brackets stripped",
      (url) => {
        expect(reasonOf(url)).toMatch(/private or loopback/i);
      },
    );
  });

  describe("when the escape hatch is on", () => {
    /** @scenario "The escape hatch relaxes the origin and the local-address block, and nothing else" */
    it("admits a loopback destination", () => {
      expect(judge("http://127.0.0.1:4101/hook", true)).toEqual({ admitted: true });
    });
  });
});
