import { DispatchError } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import { assertWebhookUrlAllowed, inspectWebhookUrl } from "../url-policy";

/**
 * Spec: packages/egress/specs/webhook-egress.feature
 *
 * The admission matrix both webhook channels share, pinned as a table of
 * literals. Every row is asserted under BOTH escape-hatch states, because
 * "which rules the hatch relaxes" is the part that silently drifts — and a rule
 * that quietly widened does not fail anything, it delivers to an address it
 * should have refused.
 */

const inspect = (url: string, allowInsecureLocal = false) =>
  inspectWebhookUrl({ url, allowInsecureLocal });

const capture = (fn: () => void): DispatchError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof DispatchError) return error;
    throw error;
  }
  throw new Error("expected the assertion to throw");
};

describe("the webhook URL admission policy", () => {
  describe("given the escape hatch is off, as every automation dispatch has it", () => {
    /** @scenario "Only https on the default port is admitted" */
    it("admits https on the default port and nothing else", () => {
      expect(inspect("https://example.com/hooks/lw")).toBeNull();
      expect(inspect("https://example.com:443/hooks/lw")).toBeNull();
      expect(inspect("http://example.com/x")?.code).toBe("scheme");
      expect(inspect("ftp://example.com/x")?.code).toBe("scheme");
      expect(inspect("not a url")?.code).toBe("invalid_url");
    });

    /** @scenario "Only https on the default port is admitted" */
    it("refuses a non-default port, which is what a port probe looks like", () => {
      expect(inspect("https://example.com:8443/x")?.code).toBe("port");
      expect(inspect("https://internal:6379/x")?.code).toBe("port");
    });

    /** @scenario "A URL carrying credentials is refused whatever else is relaxed" */
    it("refuses credentials in the URL", () => {
      expect(inspect("https://user:pass@example.com/x")?.code).toBe("credentials");
      expect(inspect("https://user@example.com/x")?.code).toBe("credentials");
    });
  });

  describe("given the escape hatch is on, as a self-hosted endpoints install has it", () => {
    /** @scenario "The escape hatch relaxes the origin and the local-address block, and nothing else" */
    it("admits plain http on a non-default port, which is what a local receiver needs", () => {
      expect(inspect("http://localhost:4101/hook", true)).toBeNull();
      expect(inspect("http://receiver.internal:8080/hook", true)).toBeNull();
    });

    /** @scenario "The escape hatch relaxes the origin and the local-address block, and nothing else" */
    it("still refuses a scheme that is neither http nor https", () => {
      expect(inspect("ftp://example.com/x", true)?.code).toBe("scheme");
    });

    /** @scenario "A URL carrying credentials is refused whatever else is relaxed" */
    it("still refuses credentials, which no receiver ever needs", () => {
      expect(inspect("http://user:pass@localhost:4101/x", true)?.code).toBe("credentials");
    });
  });
});

describe("assertWebhookUrlAllowed", () => {
  describe("when the URL fails the shape check", () => {
    /** @scenario "Only https on the default port is admitted" */
    it("throws terminally, carrying the label and the rule that was broken", () => {
      const error = capture(() =>
        assertWebhookUrlAllowed({
          url: "https://example.com:8443/x",
          label: "Endpoint ep_1",
          allowInsecureLocal: false,
        }),
      );

      expect(error.retryable).toBe(false);
      expect(error.message).toContain("Endpoint ep_1");
      expect(error.message).toContain("443");
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
      const error = capture(() =>
        assertWebhookUrlAllowed({ url, label: "Automation x", allowInsecureLocal: false }),
      );

      expect(error.retryable).toBe(false);
      expect(error.message).toMatch(/private or loopback/i);
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
        const error = capture(() =>
          assertWebhookUrlAllowed({ url, label: "Automation x", allowInsecureLocal: false }),
        );

        expect(error.retryable).toBe(false);
        expect(error.message).toMatch(/private or loopback/i);
      },
    );
  });

  describe("when the escape hatch is on", () => {
    /** @scenario "The escape hatch relaxes the origin and the local-address block, and nothing else" */
    it("admits a loopback destination", () => {
      expect(() =>
        assertWebhookUrlAllowed({
          url: "http://127.0.0.1:4101/hook",
          label: "Endpoint ep_1",
          allowInsecureLocal: true,
        }),
      ).not.toThrow();
    });
  });
});
