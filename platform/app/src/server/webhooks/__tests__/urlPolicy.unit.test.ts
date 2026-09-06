import { afterEach, describe, expect, it } from "vitest";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import { assertWebhookUrlAllowed, inspectWebhookUrl } from "../urlPolicy";

/**
 * The admission matrix both webhook channels now share. Before this policy the
 * automations channel refused non-default ports and URL credentials while the
 * endpoints platform accepted them, so the same string was a valid endpoint and
 * an invalid trigger destination at once. Every row here is asserted under both
 * escape-hatch states, because "which rules the hatch relaxes" is the part that
 * silently drifts.
 */

const inspect = (url: string, allowInsecureLocal = false) =>
  inspectWebhookUrl({ url, allowInsecureLocal });

describe("webhook URL admission policy", () => {
  describe("with the escape hatch off (the default)", () => {
    it("admits https on the default port", () => {
      expect(inspect("https://example.com/hooks/lw")).toBeNull();
      expect(inspect("https://example.com:443/hooks/lw")).toBeNull();
    });

    it("rejects a scheme that is not https", () => {
      expect(inspect("http://example.com/x")?.code).toBe("scheme");
      expect(inspect("ftp://example.com/x")?.code).toBe("scheme");
    });

    it("rejects a string that is not a URL", () => {
      expect(inspect("not a url")?.code).toBe("invalid_url");
    });

    it("rejects a non-default port", () => {
      expect(inspect("https://example.com:8443/x")?.code).toBe("port");
      expect(inspect("https://internal:6379/x")?.code).toBe("port");
    });

    it("rejects credentials in the URL", () => {
      expect(inspect("https://user:pass@example.com/x")?.code).toBe(
        "credentials",
      );
      expect(inspect("https://user@example.com/x")?.code).toBe("credentials");
    });
  });

  describe("with the escape hatch on", () => {
    it("admits http and a non-default port, which is what a local receiver needs", () => {
      expect(inspect("http://localhost:4101/hook", true)).toBeNull();
      expect(inspect("http://receiver.internal:8080/hook", true)).toBeNull();
    });

    it("still rejects a scheme that is neither http nor https", () => {
      expect(inspect("ftp://example.com/x", true)?.code).toBe("scheme");
    });

    it("still rejects credentials, which no receiver ever needs", () => {
      expect(inspect("http://user:pass@localhost:4101/x", true)?.code).toBe(
        "credentials",
      );
    });
  });
});

describe("assertWebhookUrlAllowed", () => {
  const capture = (fn: () => void): DispatchError => {
    try {
      fn();
    } catch (err) {
      if (err instanceof DispatchError) return err;
      throw err;
    }
    throw new Error("expected the assertion to throw");
  };

  describe("when the URL fails the shape check", () => {
    it("throws terminally, carrying the label and the reason", () => {
      const err = capture(() =>
        assertWebhookUrlAllowed({
          url: "https://example.com:8443/x",
          label: "Endpoint ep_1",
          allowInsecureLocal: false,
        }),
      );
      expect(err.retryable).toBe(false);
      expect(err.message).toContain("Endpoint ep_1");
      expect(err.message).toContain("443");
    });
  });

  describe("when the host is a private IP literal", () => {
    it("throws terminally rather than leaving it to the retryable DNS failure", () => {
      const err = capture(() =>
        assertWebhookUrlAllowed({
          url: "https://10.0.0.5/hook",
          label: "Trigger x",
          allowInsecureLocal: false,
        }),
      );
      expect(err.retryable).toBe(false);
      expect(err.message).toMatch(/private or loopback/i);
    });

    it("throws terminally for a bracketed IPv6 loopback", () => {
      const err = capture(() =>
        assertWebhookUrlAllowed({
          url: "https://[::1]/hook",
          label: "Trigger x",
          allowInsecureLocal: false,
        }),
      );
      expect(err.retryable).toBe(false);
      expect(err.message).toContain("::1");
    });
  });

  describe("when the escape hatch is on", () => {
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

describe("allowsInsecureLocalUrls", () => {
  const original = process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
    } else {
      process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS = original;
    }
  });

  it("is on only for the exact opt-in value", async () => {
    const { allowsInsecureLocalUrls } = await import("../urlPolicy");
    process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS = "1";
    expect(allowsInsecureLocalUrls()).toBe(true);
    process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS = "true";
    expect(allowsInsecureLocalUrls()).toBe(false);
    delete process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
    expect(allowsInsecureLocalUrls()).toBe(false);
  });
});
