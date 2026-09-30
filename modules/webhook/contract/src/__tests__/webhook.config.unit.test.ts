import { ConfigParseError, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { webhookConfig } from "../webhook.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "webhook", config: webhookConfig }], environment }).webhook;

describe("webhook server configuration", () => {
  describe("given a deployment sets neither fence", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("keeps both fences closed", () => {
      const config = read({});

      expect(config.allowInsecureLocalUrls).toBe(false);
      expect(config.allowAmbientAwsCredentials).toBe(false);
    });
  });

  describe("given a deployment opens a fence the way both processes read it", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("opens it", () => {
      expect(read({ WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS: "1" }).allowInsecureLocalUrls).toBe(true);
    });
  });

  describe("given a deployment opens a fence a way nothing reads", () => {
    /** @scenario "An unreadable switch is refused instead of read as off" */
    it("refuses the boot rather than leaving the fence quietly closed", () => {
      expect(() => read({ WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS: "true" })).toThrow(ConfigParseError);
    });
  });

  describe("given a deployment sets the standard proxy variables", () => {
    /** @scenario "Queue deliveries follow the configured outbound proxy" */
    it("reads each spelling for the SQS calls to follow", () => {
      const { outboundProxy } = read({ https_proxy: "http://proxy.corp:8080", NO_PROXY: ".corp" });

      expect(outboundProxy.https_proxy).toBe("http://proxy.corp:8080");
      expect(outboundProxy.NO_PROXY).toBe(".corp");
    });
  });
});
