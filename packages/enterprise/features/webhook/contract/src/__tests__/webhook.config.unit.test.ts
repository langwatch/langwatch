import { InvalidRuntimeConfigError, RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { webhookServerConfigDefinition } from "../webhook.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({ name: "webhook", definition: webhookServerConfigDefinition, source })
    .value;

describe("webhook server configuration", () => {
  describe("given a deployment sets neither fence", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("keeps both fences closed", () => {
      expect(read({})).toEqual({
        allowInsecureLocalUrls: false,
        allowAmbientAwsCredentials: false,
      });
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
      expect(() => read({ WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS: "true" })).toThrow(
        InvalidRuntimeConfigError,
      );
    });
  });
});
