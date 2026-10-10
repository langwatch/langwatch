import type { TriggerAction } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { sealWith } from "../../__tests__/fixtures/trigger-secrets.fixture.ts";
import { AutomationProviderRegistryService } from "../automation-provider-registry.service.ts";

const registry = AutomationProviderRegistryService.create(
  sealWith({
    encrypt: (value: string) => `enc(${value})`,
    decrypt: (value: string) => value,
  }),
);

// wrong-typed input: a stored row can name a channel this build no longer offers
const WEBHOOK_ACTION = "SEND_WEBHOOK" as TriggerAction;
const RETIRED_CHANNEL = "SEND_CARRIER_PIGEON" as TriggerAction;

describe("AutomationProviderRegistryService", () => {
  describe("given a stored row naming a channel this server does not offer", () => {
    /** @scenario "Reading an unknown delivery channel returns nothing" */
    it("returns an empty delivery configuration", () => {
      expect(
        registry.redactActionParamsFor(RETIRED_CHANNEL, {
          pigeonWebhook: "https://hooks.slack.com/services/T0/B0/XXXX",
        }),
      ).toEqual({});
    });
  });

  describe("when a delivery configuration is saved for a channel this server does not offer", () => {
    /** @scenario "A delivery channel the server no longer offers is written as it was sent" */
    it("stores the configuration as the caller sent it", async () => {
      const incoming = { pigeonWebhook: "https://hooks.example.com/x", retries: 2 };

      const stored = await registry.persistActionParamsFor(RETIRED_CHANNEL, {
        incoming,
        loadExisting: async () => undefined,
      });

      expect(stored).toEqual(incoming);
    });
  });

  describe("given a webhook URL that is http or on a high port", () => {
    const seal = sealWith({ encrypt: (value: string) => value, decrypt: (value: string) => value });
    const params = { url: "http://127.0.0.1:9100/hook" };
    const parse = (registryUnderTest: AutomationProviderRegistryService) =>
      registryUnderTest.actionParamsSchemaFor(WEBHOOK_ACTION).validate(params);

    /** @scenario "A webhook automation refuses any URL but https on port 443 in production" */
    it("refuses it when the local-URL dev switch is off", () => {
      expect(parse(AutomationProviderRegistryService.create(seal))).toBe(false);
      expect(
        AutomationProviderRegistryService.create(seal)
          .actionParamsSchemaFor(WEBHOOK_ACTION)
          .validate({ url: "https://example.com:8443/hook" }),
      ).toBe(false);
    });

    /** @scenario "The local-URL dev switch admits an http or ported webhook URL" */
    it("accepts it when the dev switch is on", () => {
      const open = AutomationProviderRegistryService.create(seal, { allowInsecureLocalUrls: true });
      expect(parse(open)).toBe(true);
    });
  });
});
